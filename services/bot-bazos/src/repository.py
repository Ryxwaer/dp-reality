"""MongoDB persistence for the Bazos bot service.

Two private collections (per the bounded-context rule):
  - listings_bazos:   raw scraped listings (analytics base + Bazos tail)
  - bazos_config:     per-configuration documents (one row per
                      user-owned configuration of this bot service;
                      `_id` is the BFF-minted `config_id`)

Plus shared writes to:
  - notifications:    one row per (user, config, source_ref) match
  - module_registry:  one-shot upsert on boot keyed by `bot_id`

Nothing in this file reads from another bot service's collections.
"""
from __future__ import annotations

import logging
from datetime import datetime, UTC
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, UpdateOne
from pymongo.errors import BulkWriteError

from .config import settings
from .models import Listing, listing_to_dict

LISTINGS_COLLECTION = "listings_bazos"
CONFIG_COLLECTION = "bazos_config"
NOTIFICATIONS_COLLECTION = "notifications"
MODULE_REGISTRY_COLLECTION = "module_registry"

logger = logging.getLogger(__name__)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    listings = db[LISTINGS_COLLECTION]
    await listings.create_index("source_id", unique=True, background=True)
    await listings.create_index("price", background=True)
    await listings.create_index("psc", background=True)
    await listings.create_index("city", background=True)
    await listings.create_index("category_main", background=True)
    await listings.create_index("category_sub", background=True)
    await listings.create_index("property_type", background=True)
    await listings.create_index([("first_seen", DESCENDING)], background=True)
    await listings.create_index("run_id", background=True)

    config = db[CONFIG_COLLECTION]
    await config.create_index("user_id", background=True)
    await config.create_index("active", background=True)

    # The (user_id, config_id, source_ref) unique index is owned jointly
    # by everyone writing into `notifications`; we declare it here so
    # the bot service can boot against a pristine DB without racing the
    # BFF index plugin.
    notifications = db[NOTIFICATIONS_COLLECTION]
    await notifications.create_index(
        [("user_id", ASCENDING), ("config_id", ASCENDING), ("source_ref", ASCENDING)],
        unique=True,
        background=True,
        name="user_config_source_unique",
    )
    await notifications.create_index(
        [("user_id", ASCENDING), ("created_at", DESCENDING)],
        background=True,
        name="user_recent",
    )

    logger.info("Indexes ensured (listings_bazos, bazos_config, notifications)")


async def upsert_listings(
    db: AsyncIOMotorDatabase, listings: list[Listing], run_id: str
) -> list[Listing]:
    """Insert-or-update listings; return the subset that were newly inserted.

    `run_id` is stamped via $setOnInsert so re-sightings keep their
    original run id; the return value is what the matcher iterates over
    to decide who to notify.
    """
    if not listings:
        return []

    now = datetime.now(UTC)
    payloads = [listing_to_dict(l) for l in listings]
    operations = [
        UpdateOne(
            {"source_id": payload["source_id"]},
            {
                "$setOnInsert": {"first_seen": now, "run_id": run_id},
                "$set": {**payload, "last_seen": now},
            },
            upsert=True,
        )
        for payload in payloads
    ]

    result = await db[LISTINGS_COLLECTION].bulk_write(operations, ordered=False)
    inserted_ids = set(result.upserted_ids.values())

    # `bulk_write` reports inserted docs only by their _id; we re-fetch
    # them to get the source_id we need for matching downstream.
    if not inserted_ids:
        logger.info(
            "Upserted %d listings: 0 new, %d updated (run %s)",
            len(listings),
            result.modified_count,
            run_id,
        )
        return []

    cursor = db[LISTINGS_COLLECTION].find({"_id": {"$in": list(inserted_ids)}})
    new_docs = await cursor.to_list(length=None)
    new_source_ids = {d["source_id"] for d in new_docs}
    new_listings = [l for l in listings if l.source_id in new_source_ids]

    logger.info(
        "Upserted %d listings: %d new, %d updated (run %s)",
        len(listings),
        len(new_listings),
        result.modified_count,
        run_id,
    )
    return new_listings


async def fetch_active_configs(db: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    cursor = db[CONFIG_COLLECTION].find({"active": True})
    return await cursor.to_list(length=None)


async def fetch_config(
    db: AsyncIOMotorDatabase, config_id: str
) -> dict[str, Any] | None:
    return await db[CONFIG_COLLECTION].find_one({"_id": config_id})


async def write_config(
    db: AsyncIOMotorDatabase,
    *,
    config_id: str,
    user_id: str,
    config: dict[str, Any],
) -> bool:
    """Idempotent insert. Returns True if a new doc was created."""
    now = datetime.now(UTC)
    result = await db[CONFIG_COLLECTION].update_one(
        {"_id": config_id},
        {
            "$setOnInsert": {
                "_id": config_id,
                "user_id": user_id,
                "active": True,
                "created_at": now,
            },
            "$set": {"config": config, "updated_at": now},
        },
        upsert=True,
    )
    return result.upserted_id is not None


async def mark_welcome_sent(db: AsyncIOMotorDatabase, config_id: str) -> None:
    """Audit-only stamp recorded after a successful welcome publish.
    Nothing in the platform reads this back; it lives on the row purely
    to make 'did this user get welcomed?' answerable from mongosh.
    """
    await db[CONFIG_COLLECTION].update_one(
        {"_id": config_id},
        {"$set": {"welcome_sent_at": datetime.now(UTC)}},
    )


async def insert_notifications(
    db: AsyncIOMotorDatabase, rows: list[dict[str, Any]]
) -> int:
    """Append rows to `notifications`; (user_id, config_id, source_ref)
    duplicates are silently dropped via the unique index.
    """
    if not rows:
        return 0
    try:
        result = await db[NOTIFICATIONS_COLLECTION].insert_many(rows, ordered=False)
        return len(result.inserted_ids)
    except BulkWriteError as exc:
        # E11000 = duplicate key, the only error we tolerate here.
        write_errors = exc.details.get("writeErrors", []) if exc.details else []
        non_dup = [e for e in write_errors if e.get("code") != 11000]
        if non_dup:
            raise
        inserted = exc.details.get("nInserted", 0) if exc.details else 0
        return int(inserted)


async def upsert_registry(db: AsyncIOMotorDatabase) -> None:
    """One-shot self-registration on boot.

    The platform contract treats the registry as a published catalogue:
    once a service has advertised itself, it stays listed. There is no
    heartbeat, no `last_seen`, and no manifest of internal scheduling
    state — those concerns live inside the bot service. The row is
    keyed by `bot_id`, which doubles as the compose / k8s service name
    and the URL slug under /modules/<bot_id>/* on the BFF.
    """
    await db[MODULE_REGISTRY_COLLECTION].update_one(
        {"bot_id": settings.service_id},
        {
            "$set": {
                "bot_id": settings.service_id,
                "display_name": settings.display_name,
                "description": settings.description,
                "base_url": settings.base_url,
                "category": settings.category,
                "configure_url": settings.configure_url,
                "config_collection": settings.config_collection,
            },
        },
        upsert=True,
    )

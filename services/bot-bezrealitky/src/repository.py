from __future__ import annotations

import logging
from datetime import datetime, UTC
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, UpdateOne

from .config import settings
from .models import Listing, listing_to_dict

LISTINGS_COLLECTION = "listings_bezrealitky"
CONFIG_COLLECTION = "bezrealitky_config"
NOTIFICATIONS_COLLECTION = "notifications"
MODULE_REGISTRY_COLLECTION = "module_registry"
META_COLLECTION = "bezrealitky_meta"

_SCHEMA_VERSION = 4
_GEO_COLLECTION = "bezrealitky_geo"

logger = logging.getLogger(__name__)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    listings = db[LISTINGS_COLLECTION]
    await listings.create_index("source_id", unique=True, background=True)
    await listings.create_index("price", background=True)
    await listings.create_index("city", background=True)
    await listings.create_index("estate_type", background=True)
    await listings.create_index("offer_type", background=True)
    await listings.create_index("disposition_native", background=True)
    await listings.create_index([("first_seen", DESCENDING)], background=True)
    await listings.create_index("run_id", background=True)
    await listings.create_index([("gps", "2dsphere")], background=True, name="gps_2dsphere")

    config = db[CONFIG_COLLECTION]
    await config.create_index("user_id", background=True)
    await config.create_index("active", background=True)

    notifications = db[NOTIFICATIONS_COLLECTION]
    await notifications.create_index(
        [("user_id", ASCENDING), ("bot_id", ASCENDING), ("source_ref", ASCENDING)],
        unique=True, background=True, name="user_bot_source_unique",
    )
    await notifications.create_index(
        [("user_id", ASCENDING), ("created_at", DESCENDING)],
        background=True, name="user_recent",
    )


async def migrate(db: AsyncIOMotorDatabase) -> None:
    meta = await db[META_COLLECTION].find_one({"_id": "schema"})
    current = int((meta or {}).get("version", 0))
    if current >= _SCHEMA_VERSION:
        return

    await db[LISTINGS_COLLECTION].drop()
    await db[CONFIG_COLLECTION].drop()
    await db[_GEO_COLLECTION].drop()
    logger.info(
        "migrate: dropped %s, %s, %s (schema %d -> %d)",
        LISTINGS_COLLECTION, CONFIG_COLLECTION, _GEO_COLLECTION,
        current, _SCHEMA_VERSION,
    )
    await db[META_COLLECTION].update_one(
        {"_id": "schema"},
        {"$set": {"version": _SCHEMA_VERSION, "migrated_at": datetime.now(UTC)}},
        upsert=True,
    )


async def upsert_listings(
    db: AsyncIOMotorDatabase, listings: list[Listing], run_id: str
) -> list[Listing]:
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

    if not inserted_ids:
        logger.info(
            "Upserted %d listings: 0 new, %d updated (run %s)",
            len(listings), result.modified_count, run_id,
        )
        return []

    cursor = db[LISTINGS_COLLECTION].find({"_id": {"$in": list(inserted_ids)}})
    new_docs = await cursor.to_list(length=None)
    new_source_ids = {d["source_id"] for d in new_docs}
    new_listings = [l for l in listings if l.source_id in new_source_ids]

    logger.info(
        "Upserted %d listings: %d new, %d updated (run %s)",
        len(listings), len(new_listings), result.modified_count, run_id,
    )
    return new_listings


async def update_listing_detail(
    db: AsyncIOMotorDatabase, listing: Listing
) -> None:
    await db[LISTINGS_COLLECTION].update_one(
        {"source_id": listing.source_id},
        {
            "$set": {
                "description": listing.description,
                "energy_class": listing.energy_class,
                "city": listing.city,
                "photos": listing.photos,
                "last_seen": datetime.now(UTC),
            }
        },
    )


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
    await db[CONFIG_COLLECTION].update_one(
        {"_id": config_id},
        {"$set": {"welcome_sent_at": datetime.now(UTC)}},
    )


async def insert_notifications(
    db: AsyncIOMotorDatabase, rows: list[dict[str, Any]]
) -> int:
    if not rows:
        return 0
    now = datetime.now(UTC)
    operations = [
        UpdateOne(
            {
                "user_id": r["user_id"],
                "bot_id": r["bot_id"],
                "source_ref": r["source_ref"],
            },
            {
                "$setOnInsert": {
                    "user_id": r["user_id"],
                    "bot_id": r["bot_id"],
                    "source_ref": r["source_ref"],
                    "title": r["title"],
                    "url": r["url"],
                    "html": r["html"],
                    "created_at": now,
                    "unread": True,
                    "sent_at": None,
                },
                "$addToSet": {"config_ids": r["config_id"]},
            },
            upsert=True,
        )
        for r in rows
    ]
    result = await db[NOTIFICATIONS_COLLECTION].bulk_write(operations, ordered=False)
    return int(len(result.upserted_ids or {}))


async def upsert_registry(db: AsyncIOMotorDatabase) -> None:
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

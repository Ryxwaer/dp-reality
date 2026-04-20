import logging
from datetime import datetime, UTC

from pymongo import UpdateOne
from motor.motor_asyncio import AsyncIOMotorDatabase

from models import Listing

COLLECTION = "bazos"

logger = logging.getLogger(__name__)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create every index bots ever query by, including the matcher
    operators defined in the `bazos` module's URL parser:

      * `source_id` unique — upsert key.
      * `price` — range filters from `cenaod` / `cenado`.
      * `psc`   — exact match from `hlokalita`.
      * `category_main` / `category_sub` / `property_type` — path-based filters.
      * `first_seen desc` — admin list views.
      * `run_id` — notification consumer `$match` key.

    Text indexes are *not* created for `description` on purpose: the
    `contains` matcher op emits `$regex`, which the planner won't route
    through a `$text` index anyway.
    """
    await db[COLLECTION].create_index("source_id", unique=True, background=True)
    await db[COLLECTION].create_index("price", background=True)
    await db[COLLECTION].create_index("psc", background=True)
    await db[COLLECTION].create_index("category_main", background=True)
    await db[COLLECTION].create_index("category_sub", background=True)
    await db[COLLECTION].create_index("property_type", background=True)
    await db[COLLECTION].create_index([("first_seen", -1)], background=True)
    await db[COLLECTION].create_index("run_id", background=True)
    logger.info("Indexes ensured on %s", COLLECTION)


async def upsert_listings(
    db: AsyncIOMotorDatabase, listings: list[Listing], run_id: str
) -> int:
    """Upsert listings and stamp `run_id` on *first* sight only.

    Notification service keys off `run_id` — listings upserted in later
    runs keep their original `run_id` via `$setOnInsert`, so they won't
    be re-notified.
    """
    if not listings:
        return 0

    now = datetime.now(UTC)
    operations = [
        UpdateOne(
            {"source_id": listing.source_id},
            {
                "$setOnInsert": {"first_seen": now, "run_id": run_id},
                "$set": {
                    **listing.model_dump(mode="json"),
                    "last_seen": now,
                },
                # Drop fields that earlier model versions persisted but
                # the scraper no longer fills. Mongo-level `$unset` is a
                # cheap self-heal: existing docs get cleaned on the next
                # touch; new docs are unaffected (unset of a missing
                # field is a no-op, not an error).
                "$unset": {"disposition": ""},
            },
            upsert=True,
        )
        for listing in listings
    ]

    result = await db[COLLECTION].bulk_write(operations, ordered=False)
    logger.info(
        "Upserted %d listings: %d new, %d updated (run %s)",
        len(listings),
        result.upserted_count,
        result.modified_count,
        run_id,
    )
    return result.upserted_count

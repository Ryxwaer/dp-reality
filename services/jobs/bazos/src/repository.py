import logging
from datetime import datetime, UTC

from pymongo import UpdateOne
from motor.motor_asyncio import AsyncIOMotorDatabase

from models import Listing

COLLECTION = "bazos"

logger = logging.getLogger(__name__)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
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
    """Upsert listings; stamp `run_id` only on first insert so the
    notifier treats subsequent re-saves as already-notified."""
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
                # Self-heal: clear fields earlier model versions persisted.
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

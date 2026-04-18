import logging
from datetime import datetime, UTC

from pymongo import UpdateOne
from motor.motor_asyncio import AsyncIOMotorDatabase

from models import Listing

COLLECTION = "reality"

logger = logging.getLogger(__name__)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[COLLECTION].create_index(
        [("source", 1), ("source_id", 1)], unique=True, background=True
    )
    await db[COLLECTION].create_index([("city", 1)], background=True)
    await db[COLLECTION].create_index([("price", 1)], background=True)
    await db[COLLECTION].create_index([("first_seen", -1)], background=True)
    logger.info("Indexes ensured")


async def upsert_listings(db: AsyncIOMotorDatabase, listings: list[Listing]) -> int:
    if not listings:
        return 0

    now = datetime.now(UTC)
    operations = [
        UpdateOne(
            {"source": listing.source, "source_id": listing.source_id},
            {
                "$setOnInsert": {"first_seen": now},
                "$set": {
                    **listing.model_dump(),
                    "last_seen": now,
                },
            },
            upsert=True,
        )
        for listing in listings
    ]

    result = await db[COLLECTION].bulk_write(operations, ordered=False)
    logger.info(
        "Upserted %d listings: %d new, %d updated",
        len(listings),
        result.upserted_count,
        result.modified_count,
    )
    return result.upserted_count

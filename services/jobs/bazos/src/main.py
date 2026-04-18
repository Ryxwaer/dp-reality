import asyncio
import logging
import os
from datetime import datetime

import aio_pika
import motor.motor_asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import settings
from repository import ensure_indexes, upsert_listings
from scraper import fetch_listings
from publisher import publish_completion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

_MAX_CONSECUTIVE_FAILURES = 3
_consecutive_failures = 0


async def scrape_cycle(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> None:
    global _consecutive_failures
    logger.info("Starting scrape cycle")
    try:
        listings = await fetch_listings(settings.scrape_pages)
        logger.info("Fetched %d listings from Bazos", len(listings))

        new_count = await upsert_listings(db, listings)

        if new_count > 0:
            await publish_completion(rabbitmq, new_count)

        _consecutive_failures = 0
    except Exception:
        _consecutive_failures += 1
        logger.exception(
            "Scrape cycle failed (%d/%d consecutive)",
            _consecutive_failures,
            _MAX_CONSECUTIVE_FAILURES,
        )
        if _consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
            logger.critical("Consecutive failure threshold reached — exiting for restart")
            os._exit(1)


async def main() -> None:
    client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
    db = client.get_default_database()
    await ensure_indexes(db)

    rabbitmq = await aio_pika.connect_robust(settings.rabbitmq_url)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        scrape_cycle,
        "interval",
        minutes=settings.scrape_interval_minutes,
        args=[db, rabbitmq],
        next_run_time=datetime.now(),
    )
    scheduler.start()
    logger.info(
        "Scraper started, interval: %d min, pages per run: %d",
        settings.scrape_interval_minutes,
        settings.scrape_pages,
    )

    try:
        await asyncio.Event().wait()
    finally:
        scheduler.shutdown()
        await rabbitmq.close()
        client.close()


if __name__ == "__main__":
    asyncio.run(main())

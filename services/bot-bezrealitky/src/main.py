from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import aio_pika
import motor.motor_asyncio
import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from . import api, cycle, geo, repository, telemetry
from .config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    telemetry.setup_telemetry()

    client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
    db = client.get_default_database()

    await repository.migrate(db)
    await repository.ensure_indexes(db)
    await geo.ensure_indexes(db)
    await geo.seed_if_needed(db)
    await repository.upsert_registry(db)

    rabbitmq = await aio_pika.connect_robust(settings.rabbitmq_url)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        cycle.run_cycle,
        "interval",
        minutes=settings.scrape_interval_minutes,
        args=[db, rabbitmq],
        next_run_time=datetime.now(),
    )
    scheduler.start()
    logger.info(
        "Scraper started, interval: %d min, pages per category: %d",
        settings.scrape_interval_minutes,
        settings.scrape_pages,
    )

    app = api.build_app(db, rabbitmq)
    server_config = uvicorn.Config(
        app,
        host=settings.http_host,
        port=settings.http_port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(server_config)

    try:
        await server.serve()
    finally:
        scheduler.shutdown(wait=False)
        await rabbitmq.close()
        client.close()


if __name__ == "__main__":
    asyncio.run(main())

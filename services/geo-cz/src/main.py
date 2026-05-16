from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import motor.motor_asyncio
import uvicorn

from . import api, repository, seeder
from .config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
    db = client.get_default_database()

    await repository.ensure_indexes(db)
    await seeder.seed_if_needed(db, Path(settings.geo_data_path))

    app = api.build_app(db)
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
        client.close()


if __name__ == "__main__":
    asyncio.run(main())

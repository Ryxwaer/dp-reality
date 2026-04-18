import logging
import signal
from datetime import datetime, UTC

import pymongo

from config import settings
from manifest import MANIFEST
from grpc_server import serve_grpc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def register_module(db) -> None:
    grpc_address = f"{settings.service_name}:{settings.grpc_port}"
    db["modules"].update_one(
        {"module_id": MANIFEST["module_id"]},
        {"$set": {
            **MANIFEST,
            "grpc_address": grpc_address,
            "last_registered": datetime.now(UTC),
        }},
        upsert=True,
    )
    logger.info('Registered module "%s" with gRPC at %s', MANIFEST["module_id"], grpc_address)


def main() -> None:
    client = pymongo.MongoClient(settings.mongodb_uri)
    db = client.get_default_database()

    register_module(db)

    server = serve_grpc(db, settings.grpc_port)
    logger.info("Module server ready")

    stop = lambda *_: server.stop(grace=5)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.wait_for_termination()
    client.close()


if __name__ == "__main__":
    main()

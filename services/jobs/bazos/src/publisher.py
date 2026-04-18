import json
import logging
from datetime import datetime, UTC

import aio_pika

EXCHANGE_NAME = "scrape.completed"
SOURCE = "bazos"

logger = logging.getLogger(__name__)


async def publish_completion(
    connection: aio_pika.RobustConnection, new_count: int
) -> None:
    async with connection.channel() as channel:
        exchange = await channel.declare_exchange(
            EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True
        )
        payload = json.dumps(
            {
                "source": SOURCE,
                "new_count": new_count,
                "timestamp": datetime.now(UTC).isoformat(),
            }
        ).encode()
        await exchange.publish(
            aio_pika.Message(
                body=payload,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key="",
        )
    logger.debug("Published scrape.completed: %d new listings", new_count)

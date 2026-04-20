import json
import logging

import aio_pika

EXCHANGE_NAME = "scrape.completed"
SOURCE = "bazos"
COLLECTION = "bazos"

logger = logging.getLogger(__name__)


async def publish_completion(
    connection: aio_pika.RobustConnection, run_id: str
) -> None:
    async with connection.channel() as channel:
        exchange = await channel.declare_exchange(
            EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True
        )
        payload = json.dumps(
            {
                "run_id": run_id,
                "source": SOURCE,
                "collection": COLLECTION,
            }
        ).encode()
        await exchange.publish(
            aio_pika.Message(
                body=payload,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key="",
        )
    logger.debug("Published scrape.completed run=%s", run_id)

from __future__ import annotations

import json
import logging
from typing import Any

import aio_pika

# Two fanout exchanges with distinct payload contracts:
#   notify.bot.processed — pointer tuple {user_id, bot_id, run_id};
#       emitted at most once per (user, bot, run); consumers read
#       freshly-written rows from the shared `notifications` collection.
#   notify.bot.welcome   — event-carried state, includes (subject, html);
#       email-notifier sends immediately, never touches notifications.
EXCHANGE_PROCESSED = "notify.bot.processed"
EXCHANGE_WELCOME = "notify.bot.welcome"

logger = logging.getLogger(__name__)


async def _publish(
    connection: aio_pika.RobustConnection,
    exchange_name: str,
    payload: dict[str, Any],
) -> None:
    async with connection.channel() as channel:
        exchange = await channel.declare_exchange(
            exchange_name, aio_pika.ExchangeType.FANOUT, durable=True
        )
        await exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key="",
        )


async def publish_bot_processed(
    connection: aio_pika.RobustConnection,
    *,
    user_id: str,
    bot_id: str,
    run_id: str,
) -> None:
    payload = {"user_id": user_id, "bot_id": bot_id, "run_id": run_id}
    await _publish(connection, EXCHANGE_PROCESSED, payload)
    logger.debug(
        "Published notify.bot.processed user=%s bot=%s run=%s",
        user_id, bot_id, run_id,
    )


async def publish_bot_welcome(
    connection: aio_pika.RobustConnection,
    payload: dict[str, Any],
) -> None:
    await _publish(connection, EXCHANGE_WELCOME, payload)
    logger.debug(
        "Published notify.bot.welcome user=%s config=%s",
        payload.get("user_id"), payload.get("config_id"),
    )

"""RabbitMQ publishers for bot-emitted events.

Two fanout exchanges, two contracts:
  - notify.bot.processed: a scrape cycle finished and produced at
    least one notification row for `user_id` across one-or-more of
    that user's configs in this bot service. Emitted exactly once per
    (user, bot, run); the payload is a pointer tuple
    ({user_id, bot_id, run_id}) and consumers read the actual rows
    from the shared notifications collection. Per-config grouping is
    a downstream concern — bot services intentionally do not emit one
    event per config because the cycle, not the config, is what
    completed.
  - notify.bot.welcome: a brand-new configuration has been saved.
    Payload is event-carried state — it includes the bot-rendered
    HTML welcome card and a subject line, so the email-notifier never
    needs to look up listings or templates.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import aio_pika

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
        user_id,
        bot_id,
        run_id,
    )


async def publish_bot_welcome(
    connection: aio_pika.RobustConnection,
    payload: dict[str, Any],
) -> None:
    await _publish(connection, EXCHANGE_WELCOME, payload)
    logger.debug(
        "Published notify.bot.welcome user=%s config=%s",
        payload.get("user_id"),
        payload.get("config_id"),
    )

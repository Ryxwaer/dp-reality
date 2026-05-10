"""End-to-end scrape → match → notify → emit cycle."""
from __future__ import annotations

import logging
import os
import uuid
from collections import defaultdict
from typing import Iterable

import aio_pika
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from . import matcher, notifications, publisher, repository, scraper
from .config import settings
from .models import BotConfig, Listing

logger = logging.getLogger(__name__)

_MAX_CONSECUTIVE_FAILURES = 3
_consecutive_failures = 0


async def run_cycle(
    db: AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> None:
    global _consecutive_failures
    run_id = str(uuid.uuid4())
    logger.info("Starting scrape cycle (run %s)", run_id)
    try:
        listings = await scraper.fetch_listings(settings.scrape_pages)
        logger.info("Fetched %d listings", len(listings))

        new_listings = await repository.upsert_listings(db, listings, run_id)
        if not new_listings:
            _consecutive_failures = 0
            return

        await _match_and_notify(db, rabbitmq, new_listings, run_id)
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


async def _match_and_notify(
    db: AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
    new_listings: Iterable[Listing],
    run_id: str,
) -> None:
    configs = await repository.fetch_active_configs(db)
    if not configs:
        return

    new_listings = list(new_listings)
    matches_by_config: dict[tuple[str, str], list[Listing]] = defaultdict(list)

    for cfg_doc in configs:
        try:
            cfg: BotConfig = matcher.parse_config_doc(cfg_doc)
        except ValidationError as err:
            logger.warning("skip invalid config %s: %s", cfg_doc.get("_id"), err)
            continue
        config_id = str(cfg_doc["_id"])
        user_id = str(cfg_doc["user_id"])
        for listing in new_listings:
            if matcher.matches(cfg, listing):
                matches_by_config[(user_id, config_id)].append(listing)

    # First pass: insert notification rows per (user, config). Then
    # collapse to one event per user — the cycle is what completed,
    # not any individual config — so downstream consumers see at most
    # one notify.bot.processed per (user, bot, run).
    users_with_inserts: set[str] = set()
    for (user_id, config_id), listings_for_cfg in matches_by_config.items():
        rows = [
            notifications.build_notification(
                user_id=user_id, config_id=config_id, listing=l
            )
            for l in listings_for_cfg
        ]
        inserted = await repository.insert_notifications(db, rows)
        if inserted > 0:
            users_with_inserts.add(user_id)

    for user_id in users_with_inserts:
        try:
            await publisher.publish_bot_processed(
                rabbitmq,
                user_id=user_id,
                bot_id=settings.service_id,
                run_id=run_id,
            )
        except Exception as err:
            # Notifications are persisted; the email notifier and SSE
            # bridge will pick them up on the next event of any kind.
            logger.warning(
                "publish notify.bot.processed failed (rows persisted): %s", err
            )

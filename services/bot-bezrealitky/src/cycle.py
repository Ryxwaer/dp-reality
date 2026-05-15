"""End-to-end scrape -> enrich -> match -> notify -> emit cycle."""
from __future__ import annotations

import logging
import os
import time
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

# When Bezrealitky responds 429 / 403 we record the wall-clock time
# and skip subsequent cycles until the backoff window elapses. The
# orchestrator-level interval (`scrape_interval_minutes`) still fires
# on schedule; the cycle function itself becomes a no-op while
# `_blocked_until` is in the future, which gives us the per-block
# pause the thesis demands without holding the scheduler thread.
_blocked_until: float = 0.0


async def run_cycle(
    db: AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> None:
    global _consecutive_failures, _blocked_until
    now = time.monotonic()
    if now < _blocked_until:
        remaining = int(_blocked_until - now)
        logger.info(
            "Skipping cycle, in backoff window (%ds remaining)", remaining
        )
        return

    run_id = str(uuid.uuid4())
    logger.info("Starting scrape cycle (run %s)", run_id)
    try:
        try:
            listings = await scraper.fetch_listings()
        except scraper._BlockedError as exc:
            _blocked_until = time.monotonic() + settings.backoff_minutes_on_block * 60
            logger.warning(
                "bezrealitky blocked us (%s); backing off for %d min",
                exc,
                settings.backoff_minutes_on_block,
            )
            return

        logger.info("Fetched %d listings", len(listings))

        new_listings = await repository.upsert_listings(db, listings, run_id)
        if not new_listings:
            _consecutive_failures = 0
            return

        await scraper.enrich_with_detail(new_listings)
        await _persist_detail(db, new_listings)

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
            logger.critical(
                "Consecutive failure threshold reached \u2014 exiting for restart"
            )
            os._exit(1)


async def _persist_detail(
    db: AsyncIOMotorDatabase, listings: Iterable[Listing]
) -> None:
    for listing in listings:
        if listing.description or listing.energy_class or listing.photos:
            try:
                await repository.update_listing_detail(db, listing)
            except Exception as exc:
                logger.warning(
                    "could not persist detail for %s: %s", listing.source_id, exc
                )


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
    rows_by_user: dict[str, list[dict]] = defaultdict(list)

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
                rows_by_user[user_id].append(
                    notifications.build_notification(
                        user_id=user_id,
                        bot_id=settings.service_id,
                        config_id=config_id,
                        listing=listing,
                    )
                )

    users_with_inserts: set[str] = set()
    for user_id, rows in rows_by_user.items():
        if not rows:
            continue
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
            logger.warning(
                "publish notify.bot.processed failed (rows persisted): %s", err
            )

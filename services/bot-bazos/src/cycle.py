from __future__ import annotations

import logging
import os
import uuid
from collections import defaultdict
from typing import Iterable

import aio_pika
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from . import geo, matcher, notifications, publisher, repository, scraper
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
            logger.critical("Consecutive failure threshold reached, exiting for restart")
            os._exit(1)


async def _resolve_allowed_pscs(
    db: AsyncIOMotorDatabase, cfg: BotConfig
) -> set[str] | None:
    if not cfg.psc or not cfg.radius_km:
        return None
    return await geo.in_radius_by_psc(db, cfg.psc, cfg.radius_km)


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
        try:
            allowed_pscs = await _resolve_allowed_pscs(db, cfg)
        except LookupError as err:
            logger.error(
                "geo lookup failed for config %s (psc=%s, km=%s): %s, skipping",
                cfg_doc.get("_id"), cfg.psc, cfg.radius_km, err,
            )
            continue
        config_id = str(cfg_doc["_id"])
        user_id = str(cfg_doc["user_id"])
        for listing in new_listings:
            if matcher.matches(cfg, listing, allowed_pscs=allowed_pscs):
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
        await publisher.publish_bot_processed(
            rabbitmq,
            user_id=user_id,
            bot_id=settings.service_id,
            run_id=run_id,
        )

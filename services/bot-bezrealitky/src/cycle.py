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

from . import geo, matcher, notifications, publisher, repository, scraper
from .config import settings
from .models import BotConfig, Listing

logger = logging.getLogger(__name__)

_MAX_CONSECUTIVE_FAILURES = 3
_consecutive_failures = 0
_blocked_until: float = 0.0


async def run_cycle(
    db: AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> None:
    global _consecutive_failures, _blocked_until
    now = time.monotonic()
    if now < _blocked_until:
        remaining = int(_blocked_until - now)
        logger.info("Skipping cycle, in backoff window (%ds remaining)", remaining)
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
                exc, settings.backoff_minutes_on_block,
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
            _consecutive_failures, _MAX_CONSECUTIVE_FAILURES,
        )
        if _consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
            logger.critical("Consecutive failure threshold reached — exiting for restart")
            os._exit(1)


async def _persist_detail(
    db: AsyncIOMotorDatabase, listings: Iterable[Listing]
) -> None:
    for listing in listings:
        if listing.description or listing.energy_class or listing.photos:
            await repository.update_listing_detail(db, listing)


async def _build_region_filter(
    db: AsyncIOMotorDatabase, cfg: BotConfig
) -> matcher.RegionFilter | None:
    """Compose the polygon+buffer predicate for this config, once per cycle.

    Configs are required to have all referenced OSM ids in
    `bezrealitky_geo` at save time (api.py enforces it). Missing entries
    are skipped silently here; the matcher's fail-closed posture rejects
    listings rather than match-all.
    """
    if not cfg.region_osm_ids or cfg.radius_km is None:
        return None
    records = await geo.find_many(db, cfg.region_osm_ids, with_geometry=True)
    if not records:
        return None
    return geo.build_region_filter(list(records.values()), cfg.radius_km)


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
        region_filter = await _build_region_filter(db, cfg)
        config_id = str(cfg_doc["_id"])
        user_id = str(cfg_doc["user_id"])
        for listing in new_listings:
            if matcher.matches(cfg, listing, region_filter=region_filter):
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

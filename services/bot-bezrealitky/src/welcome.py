"""Welcome message composition for newly-created Bezrealitky bots.

Published exactly once per new configuration as `notify.bot.welcome`.
The card embeds an English summary of the chosen filters plus the
count of currently-stored listings that satisfy them, so the email
notifier never needs to look anything up.
"""
from __future__ import annotations

import html as html_lib
import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from . import geo, matcher, repository
from .config import settings
from .models import (
    BotConfig,
    Condition,
    EstateType,
    Listing,
    OfferType,
    Ownership,
    disposition_label,
)

logger = logging.getLogger(__name__)


_OFFER_LABELS: dict[OfferType, str] = {
    OfferType.PRODEJ: "for sale",
    OfferType.PRONAJEM: "for rent",
}

_ESTATE_LABELS: dict[EstateType, str] = {
    EstateType.BYT: "apartments",
    EstateType.DUM: "houses",
    EstateType.POZEMEK: "land",
    EstateType.GARAZ: "garages",
    EstateType.KANCELAR: "offices",
    EstateType.NEBYTOVY_PROSTOR: "non-residential properties",
    EstateType.REKREACNI_OBJEKT: "leisure properties",
}

_OWNERSHIP_LABELS: dict[Ownership, str] = {
    Ownership.OSOBNI: "personal ownership",
    Ownership.DRUZSTEVNI: "cooperative",
    Ownership.OBECNI: "municipal",
    Ownership.OSTATNI: "other ownership",
}

_CONDITION_LABELS: dict[Condition, str] = {
    Condition.VERY_GOOD: "very good",
    Condition.GOOD: "good",
    Condition.BAD: "bad",
    Condition.CONSTRUCTION: "under construction",
    Condition.PROJECT: "project",
    Condition.NEW: "new",
    Condition.DEMOLITION: "demolition",
    Condition.BEFORE_RECONSTRUCTION: "before reconstruction",
    Condition.AFTER_RECONSTRUCTION: "after reconstruction",
    Condition.AFTER_PARTIAL_RECONSTRUCTION: "after partial reconstruction",
    Condition.IN_RECONSTRUCTION: "in reconstruction",
}


def _format_filter_summary(
    cfg: BotConfig, region_names: list[str]
) -> str:
    estate_label = _ESTATE_LABELS.get(cfg.estate_type) if cfg.estate_type else None
    head = (estate_label or "Listings").capitalize()
    parts: list[str] = []
    offer_label = _OFFER_LABELS.get(cfg.offer_type, "") if cfg.offer_type else ""
    parts.append(f"{head} {offer_label}".strip())

    if cfg.disposition_in:
        parts.append(", ".join(disposition_label(d) or d.value for d in cfg.disposition_in))

    if cfg.price_min is not None and cfg.price_max is not None:
        parts.append(f"{cfg.price_min:,}–{cfg.price_max:,} CZK".replace(",", " "))
    elif cfg.price_min is not None:
        parts.append(f"from {cfg.price_min:,} CZK".replace(",", " "))
    elif cfg.price_max is not None:
        parts.append(f"up to {cfg.price_max:,} CZK".replace(",", " "))

    if cfg.surface_min is not None and cfg.surface_max is not None:
        parts.append(f"{cfg.surface_min}–{cfg.surface_max} m\u00b2")
    elif cfg.surface_min is not None:
        parts.append(f"from {cfg.surface_min} m\u00b2")
    elif cfg.surface_max is not None:
        parts.append(f"up to {cfg.surface_max} m\u00b2")

    if cfg.ownership_in:
        parts.append(", ".join(_OWNERSHIP_LABELS.get(o, o.value) for o in cfg.ownership_in))
    if cfg.condition_in:
        parts.append(", ".join(_CONDITION_LABELS.get(c, c.value) for c in cfg.condition_in))

    if region_names and cfg.radius_km is not None:
        parts.append(f"within {cfg.radius_km} km of {' / '.join(region_names)}")
    elif region_names:
        parts.append("in " + " / ".join(region_names))

    return " · ".join(p for p in parts if p)


async def _count_matching(
    db: AsyncIOMotorDatabase,
    cfg: BotConfig,
    region_filter: matcher.RegionFilter | None,
) -> int:
    cursor = db[repository.LISTINGS_COLLECTION].find({})
    docs = await cursor.to_list(length=None)
    count = 0
    for doc in docs:
        try:
            listing = Listing.model_validate(doc)
        except ValidationError:
            continue
        if matcher.matches(cfg, listing, region_filter=region_filter):
            count += 1
    return count


def _esc(value: str | None) -> str:
    return html_lib.escape(value) if value else ""


def render_welcome_card(
    *,
    bot_name: str,
    matching_count: int,
    cfg: BotConfig,
    region_names: list[str],
) -> str:
    name = _esc(bot_name) or "Untitled bot"
    summary = _esc(_format_filter_summary(cfg, region_names))
    interval = settings.scrape_interval_minutes
    count_line = (
        f"We're already tracking <strong>{matching_count:,}</strong> "
        "matching listings, and we'll email you the moment a new one appears."
        if matching_count > 0
        else (
            "We don't see any matching listings yet, but we'll keep watching "
            "and email you the moment a new one appears."
        )
    ).replace(",", " ")

    return (
        '<div style="max-width:600px;margin:0 0 12px;padding:18px 20px;'
        'border:1px solid #e2e8f0;border-radius:12px;'
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
        'background:#ffffff">'
        '<div style="font-size:12px;color:#64748b;text-transform:uppercase;'
        'letter-spacing:0.04em;margin-bottom:6px">Bezrealitky · Watchdog active</div>'
        f'<div style="font-size:18px;color:#0f172a;font-weight:600;margin-bottom:10px">'
        f'Your bot "{name}" is now watching</div>'
        f'<p style="margin:0 0 12px;font-size:13px;color:#1e293b;line-height:1.5">{count_line}</p>'
        '<div style="margin:14px 0;padding:10px 12px;background:#f8fafc;'
        'border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569">'
        '<div style="font-weight:600;color:#0f172a;margin-bottom:4px">What you asked for</div>'
        f'<div>{summary}</div>'
        '</div>'
        '<p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5">'
        f'We re-check Bezrealitky every {interval}\u00a0minute{"s" if interval != 1 else ""}. '
        'You can pause or remove this bot at any time from your dashboard.'
        '</p>'
        '</div>'
    )


def build_welcome_payload(
    *,
    user_id: str,
    config_id: str,
    bot_name: str,
    matching_count: int,
    cfg: BotConfig,
    region_names: list[str],
) -> dict[str, Any]:
    name = bot_name or "Untitled bot"
    return {
        "user_id": user_id,
        "config_id": config_id,
        "bot_id": settings.service_id,
        "subject": f'Your bot "{name}" is now watching {settings.display_name}',
        "html": render_welcome_card(
            bot_name=name,
            matching_count=matching_count,
            cfg=cfg,
            region_names=region_names,
        ),
    }


async def emit_welcome(
    db: AsyncIOMotorDatabase,
    rabbitmq,
    *,
    user_id: str,
    config_id: str,
    bot_name: str,
    cfg: BotConfig,
) -> None:
    """End-to-end: count matches, render, publish."""
    from . import publisher

    region_records = await geo.find_many(
        db, cfg.region_osm_ids, with_geometry=True
    )
    region_names: list[str] = []
    for osm_id in cfg.region_osm_ids:
        rec = region_records.get(int(osm_id))
        if rec and rec.get("name"):
            region_names.append(rec["name"])

    region_filter: matcher.RegionFilter | None = None
    if cfg.region_osm_ids and cfg.radius_km is not None and region_records:
        region_filter = geo.build_region_filter(
            list(region_records.values()), cfg.radius_km
        )

    matching_count = await _count_matching(db, cfg, region_filter)
    payload = build_welcome_payload(
        user_id=user_id,
        config_id=config_id,
        bot_name=bot_name,
        matching_count=matching_count,
        cfg=cfg,
        region_names=region_names,
    )
    await publisher.publish_bot_welcome(rabbitmq, payload)
    logger.info(
        "welcome: published for config %s (user %s, %d matching listings)",
        config_id, user_id, matching_count,
    )

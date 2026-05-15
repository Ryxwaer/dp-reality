"""Welcome message composition for newly-created Bezrealitky bots.

When the iframe POSTs a brand-new configuration to /configs/<id>, the
bot service publishes exactly one `notify.bot.welcome` event from
inside that handler. Same shape as bot-bazos: one-shot
event-carried-state, the email-notifier sends a single email on
receipt with no further lookups.

The card carries a short stats summary plus a human-readable echo of
the filters — no real listings, since the user has just been on the
portal selecting filters and a "here are listings you just saw"
digest is noise.
"""
from __future__ import annotations

import html as html_lib
import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from . import matcher, repository
from .config import settings
from .models import BotConfig, Listing, PriceType, PropertyType

logger = logging.getLogger(__name__)


_OFFER_LABELS = {
    PriceType.SALE: "for sale",
    PriceType.RENT: "for rent",
}

_PROPERTY_LABELS = {
    PropertyType.APARTMENT: "apartments",
    PropertyType.HOUSE: "houses",
    PropertyType.LAND: "land",
    PropertyType.COMMERCIAL: "commercial properties",
    PropertyType.OTHER: "properties",
}


def _format_filter_summary(cfg: BotConfig) -> str:
    """Compact left-to-right summary: type → property → price → location → keywords."""
    parts: list[str] = []
    property_label = (
        _PROPERTY_LABELS.get(cfg.property_type, "Listings")
        if cfg.property_type
        else "Listings"
    )
    offer_label = _OFFER_LABELS.get(cfg.offer_type, "") if cfg.offer_type else ""
    head = property_label[0].upper() + property_label[1:]
    if offer_label:
        parts.append(f"{head} {offer_label}")
    else:
        parts.append(head)

    if cfg.disposition_in:
        parts.append(", ".join(cfg.disposition_in))

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

    if cfg.city_contains:
        parts.append(f"in {cfg.city_contains}")
    if cfg.title_keywords:
        parts.append("matching " + ", ".join(f'"{k}"' for k in cfg.title_keywords))
    return " · ".join(parts)


async def _count_matching(db: AsyncIOMotorDatabase, cfg: BotConfig) -> int:
    """Count currently-stored listings that satisfy the matcher.

    Runs the matcher in-process rather than translating it to a Mongo
    query: keeps the matcher single-sourced. Acceptable cost — a
    one-shot per bot creation against a bounded collection.
    """
    cursor = db[repository.LISTINGS_COLLECTION].find({})
    docs = await cursor.to_list(length=None)
    count = 0
    for doc in docs:
        try:
            listing = Listing.model_validate(doc)
        except ValidationError:
            continue
        if matcher.matches(cfg, listing):
            count += 1
    return count


def _esc(value: str | None) -> str:
    return html_lib.escape(value) if value else ""


def render_welcome_card(
    *,
    bot_name: str,
    matching_count: int,
    cfg: BotConfig,
) -> str:
    name = _esc(bot_name) or "Untitled bot"
    summary = _esc(_format_filter_summary(cfg))
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
    """End-to-end: count matches, render, publish.

    Errors are logged but never propagated — the welcome email is a
    courtesy and must not block the user-visible bot creation flow.
    """
    from . import publisher

    try:
        matching_count = await _count_matching(db, cfg)
    except Exception:
        logger.exception("welcome: matching count failed for config %s", config_id)
        matching_count = 0

    payload = build_welcome_payload(
        user_id=user_id,
        config_id=config_id,
        bot_name=bot_name,
        matching_count=matching_count,
        cfg=cfg,
    )

    try:
        await publisher.publish_bot_welcome(rabbitmq, payload)
        logger.info(
            "welcome: published for config %s (user %s, %d matching listings)",
            config_id,
            user_id,
            matching_count,
        )
    except Exception:
        logger.exception("welcome: publish failed for config %s", config_id)

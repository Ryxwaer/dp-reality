"""Welcome message composition for newly-created Bazos bots.

When the iframe POSTs a brand-new configuration to /configs/<id>, the
bot service publishes exactly one `notify.bot.welcome` event from
inside that handler. Unlike `notify.bot.processed`, the welcome payload
carries everything the email-notifier needs to send the email — there
is no shared `notifications` row to fetch. The event is one-shot: the
notifier sends a single message immediately on receipt.

The card intentionally contains no real listings: the user has just
been on the portal selecting filters, so a "here are listings you just
saw" digest is noise. We send a short stats summary instead, plus a
human-readable echo of the filter so the user can confirm it.
"""
from __future__ import annotations

import html as html_lib
import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import ValidationError

from . import matcher, repository
from .config import settings
from .models import BotConfig, Listing

logger = logging.getLogger(__name__)


_PRICE_TYPES = {"prodam": "for sale", "pronajmu": "for rent"}
_PROPERTY_LABELS = {
    "byt": "apartments",
    "dum": "houses",
    "pozemek": "land",
    "nebytove-prostory": "commercial space",
    "kancelar": "offices",
    "sklad": "warehouses",
    "obchod": "retail spaces",
    "garaz": "garages",
    "chata": "cottages",
    "chalupa": "chalets",
    "ostatni": "other listings",
}


def _format_filter_summary(cfg: BotConfig) -> str:
    """One-line, human-readable echo of the matcher criteria.

    Order is deliberately fixed (transaction → property → price →
    location → keywords) so the user can scan it left-to-right without
    surprises. Anything left at default is omitted.
    """
    parts: list[str] = []
    transaction = _PRICE_TYPES.get(cfg.category_main or "", "")
    property_label = _PROPERTY_LABELS.get(cfg.category_sub or "", "listings")
    if transaction:
        parts.append(f"{property_label.capitalize()} {transaction}")
    else:
        parts.append(property_label.capitalize())

    if cfg.price_min is not None and cfg.price_max is not None:
        parts.append(f"{cfg.price_min:,}–{cfg.price_max:,} CZK".replace(",", " "))
    elif cfg.price_min is not None:
        parts.append(f"from {cfg.price_min:,} CZK".replace(",", " "))
    elif cfg.price_max is not None:
        parts.append(f"up to {cfg.price_max:,} CZK".replace(",", " "))

    if cfg.city_contains:
        parts.append(f"in {cfg.city_contains}")
    if cfg.psc_prefix:
        parts.append(f"PSČ {cfg.psc_prefix}*")
    if cfg.title_keywords:
        parts.append("matching " + ", ".join(f'"{k}"' for k in cfg.title_keywords))
    return " · ".join(parts)


async def _count_matching(db: AsyncIOMotorDatabase, cfg: BotConfig) -> int:
    """Count currently-stored listings that satisfy the matcher.

    Runs the matcher in-process rather than translating it to a Mongo
    query: keeps the matcher single-sourced (the same code that decides
    "is this a notification worth sending?" decides what gets counted).
    Acceptable cost: this is a one-shot per bot creation against a
    bounded collection (a few thousand documents at the project scale).
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


def _esc(s: str | None) -> str:
    return html_lib.escape(s) if s else ""


def render_welcome_card(
    *,
    bot_name: str,
    matching_count: int,
    cfg: BotConfig,
) -> str:
    """Self-contained HTML card; same conventions as match cards."""
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
        'letter-spacing:0.04em;margin-bottom:6px">Bazos.cz · Watchdog active</div>'
        f'<div style="font-size:18px;color:#0f172a;font-weight:600;margin-bottom:10px">'
        f'Your bot "{name}" is now watching</div>'
        f'<p style="margin:0 0 12px;font-size:13px;color:#1e293b;line-height:1.5">{count_line}</p>'
        '<div style="margin:14px 0;padding:10px 12px;background:#f8fafc;'
        'border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569">'
        '<div style="font-weight:600;color:#0f172a;margin-bottom:4px">What you asked for</div>'
        f'<div>{summary}</div>'
        '</div>'
        '<p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5">'
        f'We re-check Bazos.cz every {interval}\u00a0minute{"s" if interval != 1 else ""}. '
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

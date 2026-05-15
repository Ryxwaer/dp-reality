"""Per-user matching for Bezrealitky.

The matcher uses native Python operations on the fields written into
`listings_bezrealitky` by this bot service. It is intentionally not a
portable DSL: the platform's whole point is that the matcher's shape
is owned by the bot service and never leaves it (§3.3.3).
"""
from __future__ import annotations

from typing import Any

from .models import BotConfig, Listing


def _matches_keyword(text: str | None, keywords: list[str]) -> bool:
    if not keywords:
        return True
    if not text:
        return False
    haystack = text.lower()
    return all(k.lower() in haystack for k in keywords)


def matches(config: BotConfig, listing: Listing) -> bool:
    if config.offer_type and listing.offer_type != config.offer_type:
        return False
    if config.property_type and listing.property_type != config.property_type:
        return False
    if config.price_min is not None:
        if listing.price is None or listing.price < config.price_min:
            return False
    if config.price_max is not None:
        if listing.price is None or listing.price > config.price_max:
            return False
    if config.city_contains:
        haystack = (listing.city or "").lower()
        if config.city_contains.lower() not in haystack:
            return False
    if config.disposition_in:
        if (listing.disposition or "") not in config.disposition_in:
            return False
    if config.surface_min is not None:
        if listing.surface_m2 is None or listing.surface_m2 < config.surface_min:
            return False
    if config.surface_max is not None:
        if listing.surface_m2 is None or listing.surface_m2 > config.surface_max:
            return False
    if not _matches_keyword(listing.title, config.title_keywords):
        return False
    return True


def parse_config_doc(doc: dict[str, Any]) -> BotConfig:
    return BotConfig.model_validate(doc.get("config", {}))

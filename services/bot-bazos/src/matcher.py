"""Per-user matching for Bazos.

The matcher uses native Python types and operators on the listing fields
this bot service itself wrote into `listings_bazos`. It is deliberately
not a portable DSL: the platform's whole point is that the matcher's
shape is owned by the bot service and never leaves it.
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
    if config.category_main and listing.category_main != config.category_main:
        return False
    if config.category_sub and listing.category_sub != config.category_sub:
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
    if config.psc_prefix:
        if not (listing.psc and listing.psc.startswith(config.psc_prefix)):
            return False
    if not _matches_keyword(listing.title, config.title_keywords):
        return False
    return True


def parse_config_doc(doc: dict[str, Any]) -> BotConfig:
    return BotConfig.model_validate(doc.get("config", {}))

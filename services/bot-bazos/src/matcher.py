from __future__ import annotations

from typing import Any, Iterable

from .models import BotConfig, Listing


def _matches_keywords(parts: Iterable[str | None], keywords: list[str]) -> bool:
    if not keywords:
        return True
    haystack = " ".join(p for p in parts if p).lower()
    if not haystack:
        return False
    return all(k.lower() in haystack for k in keywords)


def matches(
    config: BotConfig,
    listing: Listing,
    *,
    allowed_pscs: set[str] | None = None,
) -> bool:
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
    if allowed_pscs is not None:
        if not listing.psc or listing.psc not in allowed_pscs:
            return False
    elif config.psc and not config.radius_km:
        if listing.psc != config.psc:
            return False
    if not _matches_keywords((listing.title, listing.description), config.keywords):
        return False
    return True


def parse_config_doc(doc: dict[str, Any]) -> BotConfig:
    return BotConfig.model_validate(doc.get("config", {}))

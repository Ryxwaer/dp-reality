from __future__ import annotations

from typing import Any, Iterable

from .models import BotConfig, Listing


def _matches_keywords(parts: Iterable[str | None], keywords: list[str]) -> bool:
    """All keywords must appear (case-insensitive) somewhere in the
    concatenation of `parts`. Empty `keywords` is a wildcard.
    """
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
    """Decide whether a listing should produce a notification for this config.

    `allowed_pscs` is the precomputed set of PSČs returned by
    `geo.in_radius_by_psc` for `(config.psc, config.radius_km)`. The
    matcher is intentionally sync and IO-free; the cycle pre-resolves
    the radius via the bot's private `bazos_geo` collection once per
    (config, cycle).

    Fail-closed on the radius filter: if the user asked for a radius and
    the listing has no PSČ, we cannot prove inclusion and refuse to
    notify. Same posture as `bot-sreality` for GPS-less listings.
    """
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

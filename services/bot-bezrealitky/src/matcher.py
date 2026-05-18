from __future__ import annotations

from typing import Any, Callable

from .models import BotConfig, Listing

RegionFilter = Callable[[float, float], bool]


def matches(
    config: BotConfig,
    listing: Listing,
    *,
    region_filter: RegionFilter | None = None,
) -> bool:
    if config.offer_type and listing.offer_type != config.offer_type:
        return False
    if config.estate_type and listing.estate_type != config.estate_type:
        return False
    if config.disposition_in:
        if listing.disposition_native is None:
            return False
        if listing.disposition_native not in config.disposition_in:
            return False
    if config.ownership_in:
        if listing.ownership is None or listing.ownership not in config.ownership_in:
            return False
    if config.condition_in:
        if listing.condition is None or listing.condition not in config.condition_in:
            return False
    if config.price_min is not None:
        if listing.price is None or listing.price < config.price_min:
            return False
    if config.price_max is not None:
        if listing.price is None or listing.price > config.price_max:
            return False
    if config.surface_min is not None:
        if listing.surface_m2 is None or listing.surface_m2 < config.surface_min:
            return False
    if config.surface_max is not None:
        if listing.surface_m2 is None or listing.surface_m2 > config.surface_max:
            return False
    if config.region_osm_ids and config.radius_km is not None:
        if region_filter is None or listing.gps is None:
            return False
        lon, lat = listing.gps.coordinates[0], listing.gps.coordinates[1]
        if not region_filter(lon, lat):
            return False
    return True


def parse_config_doc(doc: dict[str, Any]) -> BotConfig:
    return BotConfig.model_validate(doc.get("config", {}))

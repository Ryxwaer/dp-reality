"""Internal models for the Bazos bot service.

The Listing fields are split into two layers:
  - the shared analytics base schema (title, property_type, disposition,
    price, price_type, city, district, source_url, first_seen, last_seen,
    run_id) — required by every bot service so cross-source $unionWith
    queries are uniform;
  - the source-specific tail (source_id, description, category_main,
    category_sub, psc, locality_raw) — opaque to other services, used by
    this service's matcher and notification renderer.

The BotConfig holds matcher fields directly (no nested DSL): each
field is consumed by `matcher.matches()` natively, with the deliberate
side effect that adding a new filter dimension requires a code change in
this service alone.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class PriceType(str, Enum):
    SALE = "sale"
    RENT = "rent"


class PropertyType(str, Enum):
    APARTMENT = "apartment"
    HOUSE = "house"
    LAND = "land"
    COMMERCIAL = "commercial"
    OTHER = "other"


class Listing(BaseModel):
    """Analytics base schema + Bazos-specific tail."""

    # Analytics base schema (REQUIRED by the platform contract).
    title: str
    property_type: PropertyType
    disposition: Optional[str] = None
    price: Optional[int] = None
    price_type: PriceType
    city: Optional[str] = None
    district: Optional[str] = None
    source_url: str

    # Source-specific tail (Bazos only).
    source_id: str
    description: Optional[str] = None
    category_main: str
    category_sub: str
    psc: Optional[str] = None
    locality_raw: Optional[str] = None


class BotConfig(BaseModel):
    """Inbound payload for POST /configs/:config_id.

    Stored as the document body in `bazos_config` (with _id=config_id,
    user_id, active, created_at attached by repository).
    """

    # Match dimensions. None = wildcard.
    category_main: Optional[str] = None  # "prodam" | "pronajmu"
    category_sub: Optional[str] = None  # "byt" | "dum" | "pozemek" | ...
    price_min: Optional[int] = None
    price_max: Optional[int] = None
    city_contains: Optional[str] = None  # case-insensitive substring of city
    psc_prefix: Optional[str] = None
    title_keywords: list[str] = Field(default_factory=list)


class StoredBotConfig(BaseModel):
    """Document shape persisted in `bazos_config`.

    `config_id` is the BFF-minted 12-byte hex string and is also the
    Mongo `_id`. `active` is flipped directly by the BFF on user
    pause/resume; this service only ever reads it.
    """

    config_id: str = Field(alias="_id")
    user_id: str
    active: bool
    created_at: datetime
    config: BotConfig

    model_config = {"populate_by_name": True}


def listing_to_dict(l: Listing) -> dict[str, Any]:
    """Serialize for Mongo upsert: enums as strings, no None pruning."""
    return l.model_dump(mode="json")

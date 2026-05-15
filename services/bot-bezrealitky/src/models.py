"""Internal models for the Bezrealitky bot service.

Same two-layer shape as bot-bazos and bot-sreality:
  - the platform analytics base schema (title, property_type, disposition,
    price, price_type, city, district, source_url) so cross-source
    $unionWith queries are uniform;
  - the source-specific tail (description, surface_m2, energy_class,
    offer_type, photos) — opaque to other services, used by this
    bot's matcher and notification renderer.

The matcher fields on `BotConfig` are likewise flat: each is consumed
by `matcher.matches()` natively. Adding a new filter dimension is a
single-service change (per §3.3.3).
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
    """Analytics base schema + Bezrealitky-specific tail."""

    title: str
    property_type: PropertyType
    disposition: Optional[str] = None
    price: Optional[int] = None
    price_type: PriceType
    city: Optional[str] = None
    district: Optional[str] = None
    source_url: str

    source_id: str
    description: Optional[str] = None
    surface_m2: Optional[int] = None
    energy_class: Optional[str] = None
    # Mirror of price_type, kept on the tail because the bot's matcher
    # and the configure page speak the source-native "sale" / "rent"
    # vocabulary directly (the platform-shared `price_type` is the
    # same value normalised; we keep both for clarity).
    offer_type: PriceType
    photos: list[str] = Field(default_factory=list)


class BotConfig(BaseModel):
    """Inbound payload for POST /configs/:config_id.

    Stored as the `config` field on the `bezrealitky_config` document.
    """

    offer_type: Optional[PriceType] = None
    property_type: Optional[PropertyType] = None
    price_min: Optional[int] = None
    price_max: Optional[int] = None
    city_contains: Optional[str] = None
    disposition_in: list[str] = Field(default_factory=list)
    surface_min: Optional[int] = None
    surface_max: Optional[int] = None
    title_keywords: list[str] = Field(default_factory=list)


class StoredBotConfig(BaseModel):
    """Document shape persisted in `bezrealitky_config`.

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


def listing_to_dict(listing: Listing) -> dict[str, Any]:
    """Serialize for Mongo upsert: enums as strings, no None pruning."""
    return listing.model_dump(mode="json")

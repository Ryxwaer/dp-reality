from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


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
    title: str
    property_type: PropertyType
    disposition: Optional[str] = None
    price: Optional[int] = None
    price_type: PriceType
    city: Optional[str] = None
    source_url: str

    source_id: str
    description: Optional[str] = None
    category_main: str
    category_sub: str
    psc: Optional[str] = None
    locality_raw: Optional[str] = None


class BotConfig(BaseModel):
    category_main: Optional[str] = None
    category_sub: Optional[str] = None
    price_min: Optional[int] = None
    price_max: Optional[int] = None
    psc: Optional[str] = None
    radius_km: Optional[int] = Field(default=None, ge=1, le=200)
    keywords: list[str] = Field(default_factory=list)

    @field_validator("psc")
    @classmethod
    def _validate_psc(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        normalised = v.replace(" ", "")
        if len(normalised) != 5 or not normalised.isdigit():
            raise ValueError("psc must be a 5-digit Czech postal code")
        return normalised


def listing_to_dict(l: Listing) -> dict[str, Any]:
    return l.model_dump(mode="json")

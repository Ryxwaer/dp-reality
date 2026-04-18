from enum import StrEnum
from pydantic import BaseModel, Field


class PropertyType(StrEnum):
    APARTMENT = "apartment"
    HOUSE = "house"
    LAND = "land"
    COMMERCIAL = "commercial"
    OTHER = "other"


class PriceType(StrEnum):
    SALE = "sale"
    RENT = "rent"


class Listing(BaseModel):
    source: str = "bazos"
    source_id: str
    title: str
    price: int | None = None
    price_type: PriceType
    property_type: PropertyType = PropertyType.OTHER
    disposition: str | None = None
    city: str | None = None
    locality_raw: str | None = None
    url: str
    features: list[str] = Field(default_factory=list)

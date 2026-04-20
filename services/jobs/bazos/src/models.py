from enum import StrEnum
from pydantic import BaseModel


class PropertyType(StrEnum):
    """Coarse property kind folded from the Bazos URL subcategory."""
    APARTMENT = "apartment"
    HOUSE = "house"
    LAND = "land"
    COMMERCIAL = "commercial"
    OTHER = "other"


class PriceType(StrEnum):
    SALE = "sale"
    RENT = "rent"


class Listing(BaseModel):
    """Listing row as shown on a Bazos category list page."""
    source_id: str

    title: str
    description: str | None = None

    price: int | None = None
    price_type: PriceType

    property_type: PropertyType = PropertyType.OTHER

    category_main: str
    category_sub: str

    psc: str | None = None
    city: str | None = None
    locality_raw: str | None = None

    url: str

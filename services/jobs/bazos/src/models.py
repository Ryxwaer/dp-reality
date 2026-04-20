from enum import StrEnum
from pydantic import BaseModel


class PropertyType(StrEnum):
    """Normalised property kind derived from the Bazos URL path.

    Bazos splits listings into `byt`, `dum`, `pozemek`, `nebytove-prostory`,
    `kancelar`, `sklad`, `obchod`, `garaz`, `chata`, `chalupa`, `ostatni` —
    we preserve the raw slug in `category_sub` and additionally fold it
    into this coarse bucket so modules can filter without learning every
    Bazos slug.
    """
    APARTMENT = "apartment"
    HOUSE = "house"
    LAND = "land"
    COMMERCIAL = "commercial"
    OTHER = "other"


class PriceType(StrEnum):
    """Derived from the URL path first segment (`prodam` / `pronajem`)
    rather than the price-text suffix — more reliable than parsing
    "Kč/měs" which isn't always present on "contact for price" rows.
    """
    SALE = "sale"
    RENT = "rent"


class Listing(BaseModel):
    """Exactly the fields Bazos's listing cards expose on the search
    list page. Matches the columns stored in the `bazos` collection
    one-to-one — no cross-source normalisation.

    Deliberately *not* stored:
      - `source`: the collection name `bazos` already identifies the
        source; keeping a scalar duplicate drifts over time.
      - `features` / amenities: not on the list page. Would require a
        per-listing detail fetch which we're not doing in v1.
    """
    source_id: str

    title: str
    description: str | None = None

    price: int | None = None
    price_type: PriceType

    # Coarse normalised bucket.
    property_type: PropertyType = PropertyType.OTHER

    # Raw URL-path slugs. Modules can use these for verbatim matching
    # ("give me `byt` ads specifically"); the coarse `property_type`
    # is for the "apartment or house" broad queries.
    category_main: str  # 'prodam' | 'pronajem'
    category_sub: str   # 'byt' | 'dum' | 'pozemek' | ...

    # Normalised 5-digit PSČ with no whitespace (e.g. "60200").
    psc: str | None = None
    # Human-readable city as extracted (e.g. "Brno").
    city: str | None = None
    # Full raw locality string, preserved for debugging / future
    # parsing without re-scraping.
    locality_raw: str | None = None

    url: str

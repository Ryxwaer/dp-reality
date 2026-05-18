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


class OfferType(str, Enum):
    PRODEJ = "PRODEJ"
    PRONAJEM = "PRONAJEM"


class EstateType(str, Enum):
    BYT = "BYT"
    DUM = "DUM"
    POZEMEK = "POZEMEK"
    GARAZ = "GARAZ"
    KANCELAR = "KANCELAR"
    NEBYTOVY_PROSTOR = "NEBYTOVY_PROSTOR"
    REKREACNI_OBJEKT = "REKREACNI_OBJEKT"


class Disposition(str, Enum):
    GARSONIERA = "GARSONIERA"
    DISP_1_KK = "DISP_1_KK"
    DISP_1_1 = "DISP_1_1"
    DISP_2_KK = "DISP_2_KK"
    DISP_2_1 = "DISP_2_1"
    DISP_3_KK = "DISP_3_KK"
    DISP_3_1 = "DISP_3_1"
    DISP_4_KK = "DISP_4_KK"
    DISP_4_1 = "DISP_4_1"
    DISP_5_KK = "DISP_5_KK"
    DISP_5_1 = "DISP_5_1"
    DISP_6_KK = "DISP_6_KK"
    DISP_6_1 = "DISP_6_1"
    DISP_7_KK = "DISP_7_KK"
    DISP_7_1 = "DISP_7_1"
    OSTATNI = "OSTATNI"


class Ownership(str, Enum):
    OSOBNI = "OSOBNI"
    DRUZSTEVNI = "DRUZSTEVNI"
    OBECNI = "OBECNI"
    OSTATNI = "OSTATNI"


class Condition(str, Enum):
    VERY_GOOD = "VERY_GOOD"
    GOOD = "GOOD"
    BAD = "BAD"
    CONSTRUCTION = "CONSTRUCTION"
    PROJECT = "PROJECT"
    NEW = "NEW"
    DEMOLITION = "DEMOLITION"
    BEFORE_RECONSTRUCTION = "BEFORE_RECONSTRUCTION"
    AFTER_RECONSTRUCTION = "AFTER_RECONSTRUCTION"
    AFTER_PARTIAL_RECONSTRUCTION = "AFTER_PARTIAL_RECONSTRUCTION"
    IN_RECONSTRUCTION = "IN_RECONSTRUCTION"


_ESTATE_TO_PROPERTY: dict[EstateType, PropertyType] = {
    EstateType.BYT: PropertyType.APARTMENT,
    EstateType.DUM: PropertyType.HOUSE,
    EstateType.POZEMEK: PropertyType.LAND,
    EstateType.KANCELAR: PropertyType.COMMERCIAL,
    EstateType.NEBYTOVY_PROSTOR: PropertyType.COMMERCIAL,
    EstateType.GARAZ: PropertyType.OTHER,
    EstateType.REKREACNI_OBJEKT: PropertyType.OTHER,
}

_OFFER_TO_PRICE: dict[OfferType, PriceType] = {
    OfferType.PRODEJ: PriceType.SALE,
    OfferType.PRONAJEM: PriceType.RENT,
}

_DISPOSITION_LABEL: dict[Disposition, str] = {
    Disposition.GARSONIERA: "garsoniera",
    Disposition.DISP_1_KK: "1+kk",
    Disposition.DISP_1_1: "1+1",
    Disposition.DISP_2_KK: "2+kk",
    Disposition.DISP_2_1: "2+1",
    Disposition.DISP_3_KK: "3+kk",
    Disposition.DISP_3_1: "3+1",
    Disposition.DISP_4_KK: "4+kk",
    Disposition.DISP_4_1: "4+1",
    Disposition.DISP_5_KK: "5+kk",
    Disposition.DISP_5_1: "5+1",
    Disposition.DISP_6_KK: "6+kk",
    Disposition.DISP_6_1: "6+1",
    Disposition.DISP_7_KK: "7+kk",
    Disposition.DISP_7_1: "7+1",
    Disposition.OSTATNI: "ostatní",
}


def estate_to_property(estate: EstateType) -> PropertyType:
    return _ESTATE_TO_PROPERTY[estate]


def offer_to_price(offer: OfferType) -> PriceType:
    return _OFFER_TO_PRICE[offer]


def disposition_label(disposition: Optional[Disposition]) -> Optional[str]:
    if disposition is None:
        return None
    return _DISPOSITION_LABEL[disposition]


class GeoPoint(BaseModel):
    type: str = "Point"
    coordinates: list[float]


class Listing(BaseModel):
    title: str
    property_type: PropertyType
    disposition: Optional[str] = None
    price: Optional[int] = None
    price_type: PriceType
    city: Optional[str] = None
    district: Optional[str] = None
    source_url: str

    source_id: str
    estate_type: EstateType
    offer_type: OfferType
    disposition_native: Optional[Disposition] = None
    ownership: Optional[Ownership] = None
    condition: Optional[Condition] = None
    currency: str = "CZK"
    surface_m2: Optional[int] = None
    street: Optional[str] = None
    zip_code: Optional[str] = None
    description: Optional[str] = None
    energy_class: Optional[str] = None
    photos: list[str] = Field(default_factory=list)
    gps: Optional[GeoPoint] = None


class BotConfig(BaseModel):
    offer_type: Optional[OfferType] = None
    estate_type: Optional[EstateType] = None
    disposition_in: list[Disposition] = Field(default_factory=list)
    ownership_in: list[Ownership] = Field(default_factory=list)
    condition_in: list[Condition] = Field(default_factory=list)
    price_min: Optional[int] = Field(default=None, ge=0)
    price_max: Optional[int] = Field(default=None, ge=0)
    surface_min: Optional[int] = Field(default=None, ge=0)
    surface_max: Optional[int] = Field(default=None, ge=0)
    region_osm_ids: list[int] = Field(default_factory=list)
    radius_km: Optional[int] = Field(default=None, ge=0, le=200)


class StoredBotConfig(BaseModel):
    config_id: str = Field(alias="_id")
    user_id: str
    active: bool
    created_at: datetime
    config: BotConfig

    model_config = {"populate_by_name": True}


def listing_to_dict(listing: Listing) -> dict[str, Any]:
    return listing.model_dump(mode="json")

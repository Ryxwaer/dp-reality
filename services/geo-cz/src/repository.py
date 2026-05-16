from __future__ import annotations

import logging
import math
import unicodedata
import re
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING

from .config import settings

logger = logging.getLogger(__name__)

# Mean Earth radius in km — used to convert km → radians for the
# $centerSphere operator, which expects spherical coordinates.
_EARTH_RADIUS_KM = 6378.1

_NON_WORD_RE = re.compile(r"[^a-z0-9]+")


def normalise_city(text: str) -> str:
    """Diacritic- and case-insensitive folded form used for indexed
    lookups: "Brno-Veveří" → "brno-veveri" → "brno veveri" → "brno-veveri".

    Stored in `city_normalised` alongside the canonical `city`, so a
    user typing "brno" matches "Brno", "BRNO" and "Brnó" equally with a
    regular B-tree index — no $regex tax.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.casefold().strip()


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    coll = db[settings.collection]
    # One document per (psc, city) tuple — preserves locality granularity
    # so "Brno-Veveří" and "Brno-Město" both remain searchable even
    # though they share PSČ 60200.
    await coll.create_index(
        [("psc", ASCENDING), ("city", ASCENDING)],
        unique=True, background=True, name="psc_city_unique",
    )
    await coll.create_index("psc", background=True, name="psc")
    await coll.create_index("city_normalised", background=True, name="city_normalised")
    await coll.create_index([("location", "2dsphere")], background=True, name="location_2dsphere")
    logger.info("geo-cz indexes ensured on %s", settings.collection)


async def count(db: AsyncIOMotorDatabase) -> int:
    return await db[settings.collection].estimated_document_count()


async def distinct_psc_count(db: AsyncIOMotorDatabase) -> int:
    return len(await db[settings.collection].distinct("psc"))


def _record_projection() -> dict[str, int]:
    return {"_id": 0, "psc": 1, "city": 1, "region": 1, "district": 1, "location": 1}


def _doc_to_record(doc: dict[str, Any]) -> dict[str, Any]:
    coords = (doc.get("location") or {}).get("coordinates") or [None, None]
    return {
        "psc": doc.get("psc"),
        "city": doc.get("city"),
        "region": doc.get("region"),
        "district": doc.get("district"),
        "lat": coords[1],
        "lon": coords[0],
    }


async def find_by_psc(db: AsyncIOMotorDatabase, psc: str) -> dict[str, Any] | None:
    # Multiple wards can share a PSČ; the representative record is
    # whichever sorts first by city — stable across boots.
    doc = await db[settings.collection].find_one(
        {"psc": psc},
        projection=_record_projection(),
        sort=[("city", ASCENDING)],
    )
    return _doc_to_record(doc) if doc else None


async def resolve_city(
    db: AsyncIOMotorDatabase, query: str, limit: int = 10
) -> list[dict[str, Any]]:
    needle = normalise_city(query)
    if not needle:
        return []
    coll = db[settings.collection]

    exact_cursor = coll.find(
        {"city_normalised": needle},
        projection=_record_projection(),
    ).limit(limit)
    exact = [_doc_to_record(d) async for d in exact_cursor]
    if exact:
        return exact

    # Fall back to a left-anchored prefix scan. We escape the needle to
    # keep regex metacharacters in user input (`.`, `*`, `(`, etc.) from
    # changing the query semantics. Index-backed left-anchored regex is
    # O(log n).
    prefix_cursor = coll.find(
        {"city_normalised": {"$regex": "^" + re.escape(needle)}},
        projection=_record_projection(),
    ).limit(limit)
    return [_doc_to_record(d) async for d in prefix_cursor]


async def in_radius(
    db: AsyncIOMotorDatabase, lat: float, lon: float, radius_km: float
) -> list[dict[str, Any]]:
    if radius_km <= 0:
        return []
    cursor = db[settings.collection].find(
        {
            "location": {
                "$geoWithin": {
                    "$centerSphere": [[lon, lat], radius_km / _EARTH_RADIUS_KM]
                }
            }
        },
        projection=_record_projection(),
    )
    return [_doc_to_record(d) async for d in cursor]


async def collection_is_empty(db: AsyncIOMotorDatabase) -> bool:
    return (await db[settings.collection].estimated_document_count()) == 0

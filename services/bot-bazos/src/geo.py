"""Private PSČ ↔ coordinate index for the Bazos bot.

Owns the `bazos_geo` collection. The bundled GeoNames CZ.txt is parsed
and upserted into Mongo on boot; from then on every radius lookup and
every city-suggest is an in-process query against this collection.

There is no runtime dependency on any peer service: the bot service
boundary owns its own matching logic end-to-end, per the platform's
bounded-context rule (one service ⇒ one private slice of Mongo ⇒ no
cross-service reads at request time).
"""
from __future__ import annotations

import logging
import re
import unicodedata
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, UpdateOne

from .config import settings

logger = logging.getLogger(__name__)

GEO_COLLECTION = "bazos_geo"

# WGS84 equatorial radius — used to convert km to radians for the
# $centerSphere operator below.
_EARTH_RADIUS_KM = 6378.1

# GeoNames postal-code dump columns (tab-separated, no header):
#   0:country  1:postal  2:place  3:region_name  4:region_code
#   5:district_name  6:district_code  7:ward_name  8:ward_code
#   9:lat  10:lon  11:accuracy
_MIN_COLUMNS = 12


def _normalise_city(text: str) -> str:
    """Diacritic- and case-insensitive folded form used for indexed
    lookups: "Brno-Veveří" → "brno-veveri". A user typing "brno" then
    matches "Brno", "BRNO" and "Brnó" with a regular B-tree index.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.casefold().strip()


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    coll = db[GEO_COLLECTION]
    await coll.create_index(
        [("psc", ASCENDING), ("city", ASCENDING)],
        unique=True, background=True, name="psc_city_unique",
    )
    await coll.create_index("psc", background=True, name="psc")
    await coll.create_index("city_normalised", background=True, name="city_normalised")
    await coll.create_index([("location", "2dsphere")], background=True, name="location_2dsphere")
    logger.info("bazos_geo indexes ensured")


def _projection() -> dict[str, int]:
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
    # Multiple wards can share a PSČ; the representative record is the
    # alphabetically-first city — stable across boots so logs stay
    # reproducible.
    doc = await db[GEO_COLLECTION].find_one(
        {"psc": psc},
        projection=_projection(),
        sort=[("city", ASCENDING)],
    )
    return _doc_to_record(doc) if doc else None


async def resolve_city(
    db: AsyncIOMotorDatabase, query: str, limit: int = 10
) -> list[dict[str, Any]]:
    needle = _normalise_city(query)
    if not needle:
        return []
    coll = db[GEO_COLLECTION]
    exact_cursor = coll.find(
        {"city_normalised": needle}, projection=_projection()
    ).limit(limit)
    exact = [_doc_to_record(d) async for d in exact_cursor]
    if exact:
        return exact
    # Fall back to a left-anchored prefix scan; escape the needle to
    # keep regex metacharacters in user input from changing semantics.
    prefix_cursor = coll.find(
        {"city_normalised": {"$regex": "^" + re.escape(needle)}},
        projection=_projection(),
    ).limit(limit)
    return [_doc_to_record(d) async for d in prefix_cursor]


async def _suggest_by_psc_prefix(
    db: AsyncIOMotorDatabase, prefix: str, limit: int
) -> list[dict[str, Any]]:
    cursor = db[GEO_COLLECTION].find(
        {"psc": {"$regex": "^" + re.escape(prefix)}},
        projection=_projection(),
        sort=[("psc", ASCENDING), ("city", ASCENDING)],
    ).limit(limit)
    return [_doc_to_record(d) async for d in cursor]


async def suggest(
    db: AsyncIOMotorDatabase, query: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Autocomplete dispatcher for the configure form's single-field
    location picker. Numeric input (1–5 digits) is treated as a PSČ
    prefix; anything else as a (diacritic-folded) city name.
    """
    q = (query or "").strip()
    if not q:
        return []
    if q.isdigit() and 1 <= len(q) <= 5:
        return await _suggest_by_psc_prefix(db, q, limit)
    return await resolve_city(db, q, limit)


async def in_radius_by_psc(
    db: AsyncIOMotorDatabase, psc: str, radius_km: float
) -> set[str]:
    """Return the set of PSČs within `radius_km` of `psc`.

    Raises `LookupError` if the anchor PSČ is not in the dataset — the
    cycle treats that as a per-config skip with an ERROR log.
    """
    anchor = await find_by_psc(db, psc)
    if not anchor:
        raise LookupError(f"PSČ not found in bazos_geo: {psc!r}")
    cursor = db[GEO_COLLECTION].find(
        {
            "location": {
                "$geoWithin": {
                    "$centerSphere": [
                        [anchor["lon"], anchor["lat"]],
                        radius_km / _EARTH_RADIUS_KM,
                    ]
                }
            }
        },
        projection={"_id": 0, "psc": 1},
    )
    return {d["psc"] async for d in cursor}


async def _is_empty(db: AsyncIOMotorDatabase) -> bool:
    return (await db[GEO_COLLECTION].estimated_document_count()) == 0


def _parse_dataset(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    rows: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n").rstrip("\r")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < _MIN_COLUMNS:
            raise ValueError(
                f"geo dataset row has {len(parts)} columns, expected >={_MIN_COLUMNS}: {line!r}"
            )
        psc = parts[1].replace(" ", "")
        if len(psc) != 5 or not psc.isdigit():
            raise ValueError(f"unexpected PSČ format in row: {line!r}")
        city = parts[2].strip()
        if not city:
            raise ValueError(f"row has empty city: {line!r}")
        rows.append({
            "psc": psc,
            "city": city,
            "city_normalised": _normalise_city(city),
            "region": parts[3].strip(),
            "district": parts[5].strip(),
            "location": {"type": "Point", "coordinates": [float(parts[10]), float(parts[9])]},
        })
    if not rows:
        raise ValueError(f"geo dataset {path} is empty")
    return rows


async def seed_if_needed(db: AsyncIOMotorDatabase, path: Path) -> None:
    """Upsert the bundled GeoNames dump into `bazos_geo`.

    Idempotent on (psc, city). `GEO_SEED_MODE` controls behaviour:
      - "missing" (default): seed only on the first boot against an
        empty collection. Subsequent boots are a no-op.
      - "always": re-upsert every boot, picking up coordinate changes
        in the upstream dump when the image is rebuilt.
      - "never": skip the seeder entirely (useful when bumping the
        image but already migrated separately).
    """
    mode = settings.geo_seed_mode
    if mode == "never":
        logger.info("bazos_geo seed: skipped (GEO_SEED_MODE=never)")
        return
    if mode == "missing" and not await _is_empty(db):
        count = await db[GEO_COLLECTION].estimated_document_count()
        logger.info("bazos_geo seed: collection already populated (%d docs), skipping", count)
        return
    if mode not in {"missing", "always"}:
        raise ValueError(f"invalid GEO_SEED_MODE: {mode!r}")

    rows = _parse_dataset(path)
    operations = [
        UpdateOne({"psc": r["psc"], "city": r["city"]}, {"$set": r}, upsert=True)
        for r in rows
    ]
    result = await db[GEO_COLLECTION].bulk_write(operations, ordered=False)
    logger.info(
        "bazos_geo seed: %d rows processed, %d inserted, %d modified",
        len(rows), len(result.upserted_ids or {}), result.modified_count,
    )

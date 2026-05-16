"""Private OSM-region index for the Bezrealitky bot.

Owns the `bezrealitky_geo` collection. Entries are keyed by OSM
relation id (the integer behind `regionOsmIds=R<id>` in any
bezrealitky.cz `/vyhledat?...` URL) and carry the region's centre
point so the matcher can run a great-circle distance check against
each listing's own GPS coordinates.

Two population paths:
  - Boot seed: the 14 Czech administrative kraje + Slovensko, fetched
    from the bezrealitky GraphQL API (`czechRegions`).
  - Lazy resolve: any OSM id the user pastes via `parse-url` that
    isn't in the seed is looked up against Nominatim and upserted on
    the fly. Failure is propagated — we refuse to store a config
    pointing at a region we can't anchor.
"""
from __future__ import annotations

import logging
import math
import re
import unicodedata
from typing import Any, Iterable

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import UpdateOne

from .config import settings

logger = logging.getLogger(__name__)

GEO_COLLECTION = "bezrealitky_geo"

_BEZREALITKY_GRAPHQL = "https://api.bezrealitky.cz/graphql/"
_NOMINATIM_LOOKUP = "https://nominatim.openstreetmap.org/lookup"
_NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"


def _normalise(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.casefold().strip()

_CZECH_REGIONS_QUERY = """
query CzechRegions($locale: Locale!) {
  czechRegions(locale: $locale) {
    id
    name
    uri
    osmId
    type
    boundary
  }
}
"""

_BOUNDARY_POINT_RE = re.compile(r"(-?\d+\.\d+)\s+(-?\d+\.\d+)")


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    coll = db[GEO_COLLECTION]
    await coll.create_index("osm_id", unique=True, background=True, name="osm_id_unique")
    await coll.create_index("name_normalised", background=True, name="name_normalised")
    await coll.create_index([("location", "2dsphere")], background=True, name="location_2dsphere")


def _projection() -> dict[str, int]:
    return {
        "_id": 0, "osm_id": 1, "name": 1, "display_name": 1,
        "uri": 1, "type": 1, "location": 1,
    }


def _doc_to_record(doc: dict[str, Any]) -> dict[str, Any]:
    coords = (doc.get("location") or {}).get("coordinates") or [None, None]
    return {
        "osm_id": doc.get("osm_id"),
        "name": doc.get("name"),
        "display_name": doc.get("display_name"),
        "uri": doc.get("uri"),
        "type": doc.get("type"),
        "lat": coords[1],
        "lon": coords[0],
    }


async def find_by_osm_id(
    db: AsyncIOMotorDatabase, osm_id: int
) -> dict[str, Any] | None:
    doc = await db[GEO_COLLECTION].find_one({"osm_id": osm_id}, projection=_projection())
    return _doc_to_record(doc) if doc else None


async def find_many(
    db: AsyncIOMotorDatabase, osm_ids: Iterable[int]
) -> dict[int, dict[str, Any]]:
    ids = list({int(x) for x in osm_ids})
    if not ids:
        return {}
    cursor = db[GEO_COLLECTION].find({"osm_id": {"$in": ids}}, projection=_projection())
    out: dict[int, dict[str, Any]] = {}
    async for doc in cursor:
        rec = _doc_to_record(doc)
        out[int(rec["osm_id"])] = rec
    return out


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two WGS84 points."""
    r_km = 6371.0088
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(a))


def _centroid_from_boundary(boundary: str) -> tuple[float, float] | None:
    """Compute a representative centre from a `((lon lat,lon lat,...))` polygon string.

    Bezrealitky's `boundary` is a flat WKT-style coordinate list (lon lat
    pairs separated by commas). We average them — fine as an anchor for
    radius matching where sub-kilometre precision is not the goal.
    """
    points: list[tuple[float, float]] = []
    for match in _BOUNDARY_POINT_RE.finditer(boundary):
        lon, lat = float(match.group(1)), float(match.group(2))
        points.append((lon, lat))
    if not points:
        return None
    lon = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return lon, lat


async def _seed_from_bezrealitky(db: AsyncIOMotorDatabase) -> int:
    """Upsert the 14 czech kraje + Slovensko into `bezrealitky_geo`."""
    headers = {
        "Origin": "https://www.bezrealitky.cz",
        "Referer": "https://www.bezrealitky.cz/",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": settings.geo_user_agent,
    }
    payload = {
        "operationName": "CzechRegions",
        "variables": {"locale": "CS"},
        "query": _CZECH_REGIONS_QUERY,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(_BEZREALITKY_GRAPHQL, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    if body.get("errors"):
        raise RuntimeError(f"czechRegions returned GraphQL errors: {body['errors']}")
    rows = ((body.get("data") or {}).get("czechRegions") or [])
    if not rows:
        raise RuntimeError("czechRegions returned an empty list")

    operations: list[UpdateOne] = []
    for row in rows:
        osm_id_raw = row.get("osmId")
        if osm_id_raw is None:
            continue
        boundary = row.get("boundary") or ""
        center = _centroid_from_boundary(boundary)
        if center is None:
            raise RuntimeError(
                f"could not derive centre for kraj {row.get('uri')!r} (osm_id={osm_id_raw})"
            )
        lon, lat = center
        name = row.get("name") or ""
        operations.append(
            UpdateOne(
                {"osm_id": int(osm_id_raw)},
                {
                    "$set": {
                        "osm_id": int(osm_id_raw),
                        "name": name,
                        "name_normalised": _normalise(name),
                        "display_name": name,
                        "uri": row.get("uri"),
                        "type": row.get("type"),
                        "location": {"type": "Point", "coordinates": [lon, lat]},
                    }
                },
                upsert=True,
            )
        )
    if not operations:
        raise RuntimeError("no usable rows in czechRegions response")
    result = await db[GEO_COLLECTION].bulk_write(operations, ordered=False)
    return len(result.upserted_ids or {}) + result.modified_count


async def resolve_via_nominatim(osm_id: int) -> dict[str, Any]:
    """Resolve an OSM relation id to {name, lat, lon} via Nominatim.

    Raises if the lookup fails or returns nothing — callers must surface
    that to the user rather than silently storing a config that can't
    match listings by radius.
    """
    headers = {"User-Agent": settings.geo_user_agent, "Accept": "application/json"}
    params = {"osm_ids": f"R{osm_id}", "format": "json", "addressdetails": "1"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(_NOMINATIM_LOOKUP, params=params, headers=headers)
        resp.raise_for_status()
        rows = resp.json()
    if not rows:
        raise LookupError(f"Nominatim has no record for relation {osm_id}")
    row = rows[0]
    addr = row.get("address") or {}
    return {
        "osm_id": int(osm_id),
        "name": row.get("name") or addr.get("city") or addr.get("town") or addr.get("village"),
        "uri": None,
        "type": row.get("type"),
        "lat": float(row["lat"]),
        "lon": float(row["lon"]),
        "display_name": row.get("display_name"),
    }


async def upsert_resolved(
    db: AsyncIOMotorDatabase, record: dict[str, Any]
) -> None:
    name = record.get("name") or ""
    await db[GEO_COLLECTION].update_one(
        {"osm_id": record["osm_id"]},
        {
            "$set": {
                "osm_id": record["osm_id"],
                "name": name,
                "name_normalised": _normalise(name),
                "uri": record.get("uri"),
                "type": record.get("type"),
                "display_name": record.get("display_name"),
                "location": {
                    "type": "Point",
                    "coordinates": [record["lon"], record["lat"]],
                },
            }
        },
        upsert=True,
    )


async def search_local(
    db: AsyncIOMotorDatabase, query: str, limit: int
) -> list[dict[str, Any]]:
    needle = _normalise(query)
    if not needle:
        return []
    coll = db[GEO_COLLECTION]
    exact = [
        _doc_to_record(d)
        async for d in coll.find(
            {"name_normalised": needle}, projection=_projection()
        ).limit(limit)
    ]
    if len(exact) >= limit:
        return exact
    seen = {r["osm_id"] for r in exact}
    prefix_cursor = coll.find(
        {"name_normalised": {"$regex": "^" + re.escape(needle)}},
        projection=_projection(),
    ).limit(limit * 2)
    async for doc in prefix_cursor:
        rec = _doc_to_record(doc)
        if rec["osm_id"] in seen:
            continue
        exact.append(rec)
        seen.add(rec["osm_id"])
        if len(exact) >= limit:
            break
    return exact


async def search_nominatim(
    query: str, limit: int = 8
) -> list[dict[str, Any]]:
    """Free-text search via Nominatim, restricted to CZ + SK administrative units.

    Returns the same record shape as `find_by_osm_id` so the UI can
    treat both sources uniformly. Caller is responsible for caching
    selected hits via `upsert_resolved` once the user picks one.
    """
    headers = {"User-Agent": settings.geo_user_agent, "Accept": "application/json"}
    params = {
        "q": query,
        "format": "json",
        "addressdetails": "1",
        "limit": str(limit),
        "countrycodes": "cz,sk",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(_NOMINATIM_SEARCH, params=params, headers=headers)
        resp.raise_for_status()
        rows = resp.json()
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if row.get("osm_type") != "relation":
            continue
        osm_id = row.get("osm_id")
        if osm_id is None:
            continue
        addr = row.get("address") or {}
        name = (
            row.get("name")
            or addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or ""
        )
        out.append({
            "osm_id": int(osm_id),
            "name": name,
            "display_name": row.get("display_name"),
            "type": row.get("type"),
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
        })
    return out


async def resolve_or_fetch(
    db: AsyncIOMotorDatabase, osm_id: int
) -> dict[str, Any]:
    """Return the geo record for `osm_id`, fetching+caching if absent.

    Always returns a record or raises — never returns None.
    """
    cached = await find_by_osm_id(db, osm_id)
    if cached:
        return cached
    record = await resolve_via_nominatim(osm_id)
    await upsert_resolved(db, record)
    return await find_by_osm_id(db, osm_id) or record


async def _is_empty(db: AsyncIOMotorDatabase) -> bool:
    return (await db[GEO_COLLECTION].estimated_document_count()) == 0


async def seed_if_needed(db: AsyncIOMotorDatabase) -> None:
    """Populate `bezrealitky_geo` with Czech kraje on first boot."""
    mode = settings.geo_seed_mode
    if mode == "never":
        logger.info("bezrealitky_geo seed: skipped (GEO_SEED_MODE=never)")
        return
    if mode not in {"missing", "always"}:
        raise ValueError(f"invalid GEO_SEED_MODE: {mode!r}")
    if mode == "missing" and not await _is_empty(db):
        count = await db[GEO_COLLECTION].estimated_document_count()
        logger.info(
            "bezrealitky_geo seed: collection already populated (%d docs), skipping", count
        )
        return

    written = await _seed_from_bezrealitky(db)
    logger.info("bezrealitky_geo seed: %d kraje upserted from bezrealitky API", written)

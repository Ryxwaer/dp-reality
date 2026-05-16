from __future__ import annotations

import logging
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import UpdateOne

from . import repository
from .config import settings

logger = logging.getLogger(__name__)

# GeoNames postal-code dump columns (tab-separated, no header):
#   0:country  1:postal  2:place  3:region_name  4:region_code
#   5:district_name  6:district_code  7:ward_name  8:ward_code
#   9:lat  10:lon  11:accuracy
_MIN_COLUMNS = 12


def _parse_file(path: Path) -> list[dict[str, object]]:
    text = path.read_text(encoding="utf-8")
    rows: list[dict[str, object]] = []
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
        lat = float(parts[9])
        lon = float(parts[10])
        rows.append({
            "psc": psc,
            "city": city,
            "city_normalised": repository.normalise_city(city),
            "region": parts[3].strip(),
            "district": parts[5].strip(),
            "location": {"type": "Point", "coordinates": [lon, lat]},
        })
    if not rows:
        raise ValueError(f"geo dataset {path} is empty")
    return rows


async def seed(db: AsyncIOMotorDatabase, path: Path) -> int:
    """Upsert the bundled GeoNames file into Mongo.

    Idempotent: each row is keyed on the unique (psc, city) tuple, so a
    re-seed of the same dataset is a no-op for unchanged rows and a
    `$set` for rows whose coordinates / region labels have shifted in
    the upstream dump.
    """
    rows = _parse_file(path)
    operations = [
        UpdateOne({"psc": r["psc"], "city": r["city"]}, {"$set": r}, upsert=True)
        for r in rows
    ]
    result = await db[settings.collection].bulk_write(operations, ordered=False)
    inserted = len(result.upserted_ids or {})
    logger.info(
        "geo-cz seed: %d rows processed, %d inserted, %d modified",
        len(rows), inserted, result.modified_count,
    )
    return inserted


async def seed_if_needed(db: AsyncIOMotorDatabase, path: Path) -> None:
    mode = settings.seed_mode
    if mode == "never":
        logger.info("geo-cz seed: skipped (SEED_MODE=never)")
        return
    if mode == "missing":
        if not await repository.collection_is_empty(db):
            logger.info(
                "geo-cz seed: collection already populated (%d docs), skipping",
                await repository.count(db),
            )
            return
    elif mode != "always":
        raise ValueError(f"invalid SEED_MODE: {mode!r}")
    await seed(db, path)

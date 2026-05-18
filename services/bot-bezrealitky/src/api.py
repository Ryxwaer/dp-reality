from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

import aio_pika
import motor.motor_asyncio
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, ValidationError

from . import geo, repository, telemetry, welcome
from .config import settings
from .models import (
    BotConfig,
    Condition,
    Disposition,
    EstateType,
    OfferType,
    Ownership,
)

logger = logging.getLogger(__name__)


class CreateBody(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    bot_name: str = Field(default="", max_length=200)


class ParseUrlBody(BaseModel):
    url: str = Field(default="", max_length=4096)


def _all_values(qs: dict[str, list[str]], *names: str) -> list[str]:
    out: list[str] = []
    for name in names:
        for v in qs.get(name, []):
            if v:
                out.append(v)
    return out


def _first(qs: dict[str, list[str]], *names: str) -> str | None:
    for name in names:
        values = qs.get(name)
        if values and values[0]:
            return values[0]
    return None


def _coerce_int(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = "".join(ch for ch in raw if ch.isdigit())
    if not cleaned:
        return None
    n = int(cleaned)
    return n if n > 0 else None


def _enum_value(raw: str, enum_cls: type) -> Any:
    try:
        return enum_cls(raw)
    except ValueError:
        return None


def _parse_osm_id(raw: str) -> int | None:
    s = raw.strip().lstrip("Rr")
    if s.isdigit():
        return int(s)
    return None


def parse_bezrealitky_url(raw: str) -> dict[str, Any]:
    trimmed = (raw or "").strip()
    if not trimmed:
        return {"ok": False, "reason": "Paste a bezrealitky.cz search URL."}
    parts = urlparse(trimmed)
    host = (parts.hostname or "").lower()
    if not (host == "bezrealitky.cz" or host.endswith(".bezrealitky.cz")):
        return {"ok": False, "reason": "URL must be on bezrealitky.cz."}

    qs = parse_qs(parts.query, keep_blank_values=False)
    out: dict[str, Any] = {}

    offer_raw = _first(qs, "offerType")
    if offer_raw:
        offer = _enum_value(offer_raw.upper(), OfferType)
        if offer is None:
            return {"ok": False, "reason": f"Unknown offerType: {offer_raw}"}
        out["offer_type"] = offer.value

    estate_raw = _first(qs, "estateType")
    if estate_raw:
        estate = _enum_value(estate_raw.upper(), EstateType)
        if estate is None:
            return {"ok": False, "reason": f"Unknown estateType: {estate_raw}"}
        out["estate_type"] = estate.value

    dispositions: list[str] = []
    for raw_d in _all_values(qs, "disposition"):
        d = _enum_value(raw_d.upper(), Disposition)
        if d is None:
            return {"ok": False, "reason": f"Unknown disposition: {raw_d}"}
        dispositions.append(d.value)
    if dispositions:
        out["disposition_in"] = list(dict.fromkeys(dispositions))

    ownerships: list[str] = []
    for raw_o in _all_values(qs, "ownership"):
        o = _enum_value(raw_o.upper(), Ownership)
        if o is None:
            return {"ok": False, "reason": f"Unknown ownership: {raw_o}"}
        ownerships.append(o.value)
    if ownerships:
        out["ownership_in"] = list(dict.fromkeys(ownerships))

    conditions: list[str] = []
    for raw_c in _all_values(qs, "condition"):
        c = _enum_value(raw_c.upper(), Condition)
        if c is None:
            return {"ok": False, "reason": f"Unknown condition: {raw_c}"}
        conditions.append(c.value)
    if conditions:
        out["condition_in"] = list(dict.fromkeys(conditions))

    price_min = _coerce_int(_first(qs, "priceFrom"))
    price_max = _coerce_int(_first(qs, "priceTo"))
    if price_min is not None:
        out["price_min"] = price_min
    if price_max is not None:
        out["price_max"] = price_max

    surface_min = _coerce_int(_first(qs, "surfaceFrom"))
    surface_max = _coerce_int(_first(qs, "surfaceTo"))
    if surface_min is not None:
        out["surface_min"] = surface_min
    if surface_max is not None:
        out["surface_max"] = surface_max

    region_ids: list[int] = []
    for raw_r in _all_values(qs, "regionOsmIds", "regionOsmId"):
        osm_id = _parse_osm_id(raw_r)
        if osm_id is None:
            return {"ok": False, "reason": f"Unrecognised regionOsmIds value: {raw_r}"}
        region_ids.append(osm_id)
    if region_ids:
        out["region_osm_ids"] = list(dict.fromkeys(region_ids))

    polygon_buffer = _coerce_int(_first(qs, "polygonBuffer"))
    if polygon_buffer is not None:
        km = max(1, round(polygon_buffer / 1000))
        out["radius_km"] = km

    osm_value = _first(qs, "osm_value")
    if osm_value:
        out["location_label"] = osm_value

    if not out:
        return {"ok": False, "reason": "Could not extract any filters from this URL."}
    return {"ok": True, "parsed": out}


def _state(request: Request) -> tuple[Any, Any]:
    return request.app.state.db, request.app.state.rabbitmq


async def _resolve_region_osm_ids(
    db: motor.motor_asyncio.AsyncIOMotorDatabase, osm_ids: list[int]
) -> None:
    for osm_id in osm_ids:
        await geo.resolve_or_fetch(db, osm_id)


def build_router() -> APIRouter:
    router = APIRouter()
    configure_html = (
        Path(__file__).parent / "templates" / "configure.html"
    ).read_text(encoding="utf-8")

    @router.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_id}

    @router.get("/configure", response_class=HTMLResponse)
    async def configure() -> HTMLResponse:
        return HTMLResponse(configure_html)

    @router.post("/parse-url")
    async def parse_url(body: ParseUrlBody) -> JSONResponse:
        return JSONResponse(parse_bezrealitky_url(body.url))

    @router.get("/regions/lookup")
    async def regions_lookup(
        request: Request,
        osm_ids: str = Query(..., min_length=1, max_length=512),
    ) -> JSONResponse:
        db, _ = _state(request)
        ids: list[int] = []
        for part in osm_ids.split(","):
            osm_id = _parse_osm_id(part)
            if osm_id is None:
                raise HTTPException(status_code=400, detail=f"bad osm id: {part!r}")
            ids.append(osm_id)
        out: list[dict[str, Any]] = []
        for osm_id in ids:
            try:
                rec = await geo.resolve_or_fetch(db, osm_id)
            except LookupError as err:
                raise HTTPException(status_code=404, detail=str(err)) from err
            out.append({
                "osm_id": rec["osm_id"],
                "name": rec.get("name"),
                "display_name": rec.get("display_name"),
                "lat": rec.get("lat"),
                "lon": rec.get("lon"),
            })
        return JSONResponse({"results": out})

    @router.get("/regions/search")
    async def regions_search(
        request: Request,
        q: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(8, ge=1, le=20),
    ) -> JSONResponse:
        db, _ = _state(request)
        local = await geo.search_local(db, q, limit)
        local_ids = {r["osm_id"] for r in local}
        results = list(local)
        if len(results) < limit:
            remote = await geo.search_nominatim(q, limit=limit)
            for rec in remote:
                if rec["osm_id"] in local_ids:
                    continue
                results.append(rec)
                local_ids.add(rec["osm_id"])
                if len(results) >= limit:
                    break
        return JSONResponse({"results": [
            {
                "osm_id": r["osm_id"],
                "name": r.get("name"),
                "display_name": r.get("display_name"),
                "lat": r.get("lat"),
                "lon": r.get("lon"),
            }
            for r in results
        ]})

    @router.get("/configs/{config_id}")
    async def get_config(
        config_id: str,
        request: Request,
        user_id: str = Query(..., min_length=1, max_length=64),
    ) -> JSONResponse:
        db, _ = _state(request)
        doc = await repository.fetch_config(db, config_id)
        if not doc:
            raise HTTPException(status_code=404, detail="config not found")
        if str(doc.get("user_id")) != user_id:
            raise HTTPException(status_code=404, detail="config not found")
        return JSONResponse(_serialize_config(doc))

    @router.post("/configs/{config_id}")
    async def post_config(
        config_id: str,
        body: CreateBody,
        request: Request,
        user_id: str = Query(..., min_length=1, max_length=64),
    ) -> JSONResponse:
        try:
            cfg = BotConfig.model_validate(body.config)
        except ValidationError as err:
            raise HTTPException(status_code=400, detail=err.errors()) from err

        db, rabbitmq = _state(request)

        if cfg.region_osm_ids:
            try:
                await _resolve_region_osm_ids(db, cfg.region_osm_ids)
            except LookupError as err:
                raise HTTPException(status_code=400, detail=str(err)) from err

        existing = await repository.fetch_config(db, config_id)
        if existing and str(existing.get("user_id")) != user_id:
            raise HTTPException(status_code=404, detail="config not found")

        created = await repository.write_config(
            db,
            config_id=config_id,
            user_id=user_id,
            config=cfg.model_dump(mode="json"),
        )
        if created:
            await welcome.emit_welcome(
                db, rabbitmq,
                user_id=user_id,
                config_id=config_id,
                bot_name=body.bot_name,
                cfg=cfg,
            )
            await repository.mark_welcome_sent(db, config_id)
        return JSONResponse(
            {"ok": True, "created": created, "config_id": config_id},
            status_code=201 if created else 200,
        )

    return router


def _serialize_config(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    out["config_id"] = out.pop("_id")
    for key, value in list(out.items()):
        if hasattr(value, "isoformat"):
            out[key] = value.isoformat()
    return out


def build_app(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> FastAPI:
    app = FastAPI(
        title="bot-bezrealitky", openapi_url=None, docs_url=None, redoc_url=None
    )
    app.state.db = db
    app.state.rabbitmq = rabbitmq
    app.include_router(build_router())
    telemetry.instrument_fastapi(app)
    return app

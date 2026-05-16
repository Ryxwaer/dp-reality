from __future__ import annotations

from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from . import repository
from .config import settings


class LookupBody(BaseModel):
    codes: list[str] = Field(default_factory=list, max_length=2000)


class InRadiusBody(BaseModel):
    lat: float | None = None
    lon: float | None = None
    psc: str | None = None
    city: str | None = None
    radius_km: float = Field(..., gt=0, le=500)


def _db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.state.db


def build_router() -> APIRouter:
    router = APIRouter()

    @router.get("/healthz")
    async def healthz(request: Request) -> dict[str, Any]:
        db = _db(request)
        return {
            "status": "ok",
            "service": settings.service_id,
            "documents": await repository.count(db),
            "unique_psc": await repository.distinct_psc_count(db),
        }

    @router.get("/psc/{psc}")
    async def get_psc(psc: str, request: Request) -> dict[str, Any]:
        record = await repository.find_by_psc(_db(request), psc)
        if not record:
            raise HTTPException(status_code=404, detail="psc not found")
        return record

    @router.post("/psc/lookup")
    async def lookup_psc(body: LookupBody, request: Request) -> dict[str, Any]:
        db = _db(request)
        out: dict[str, Any] = {}
        for code in body.codes:
            out[code] = await repository.find_by_psc(db, code)
        return out

    @router.get("/city/resolve")
    async def resolve_city(
        request: Request,
        q: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(10, ge=1, le=50),
    ) -> dict[str, Any]:
        hits = await repository.resolve_city(_db(request), q, limit=limit)
        if not hits:
            raise HTTPException(status_code=404, detail="city not found")
        return {"results": hits}

    @router.post("/in-radius")
    async def in_radius(body: InRadiusBody, request: Request) -> dict[str, Any]:
        db = _db(request)
        center: dict[str, Any] | None
        if body.lat is not None and body.lon is not None:
            lat, lon = body.lat, body.lon
            center = {"lat": lat, "lon": lon}
        elif body.psc:
            anchor = await repository.find_by_psc(db, body.psc)
            if not anchor:
                raise HTTPException(status_code=404, detail="psc not found")
            lat, lon = anchor["lat"], anchor["lon"]
            center = anchor
        elif body.city:
            hits = await repository.resolve_city(db, body.city, limit=1)
            if not hits:
                raise HTTPException(status_code=404, detail="city not found")
            anchor = hits[0]
            lat, lon = anchor["lat"], anchor["lon"]
            center = anchor
        else:
            raise HTTPException(status_code=400, detail="provide lat+lon, psc, or city")

        matches = await repository.in_radius(db, lat, lon, body.radius_km)
        # Callers care about the unique PSČ set; multiple wards under
        # the same PSČ collapse to one entry in the response.
        unique_pscs = sorted({m["psc"] for m in matches})
        return {
            "center": center,
            "radius_km": body.radius_km,
            "count": len(unique_pscs),
            "psc": unique_pscs,
        }

    return router


def build_app(db: AsyncIOMotorDatabase) -> FastAPI:
    app = FastAPI(title=settings.service_id, openapi_url=None, docs_url=None, redoc_url=None)
    app.state.db = db
    app.include_router(build_router())
    return app

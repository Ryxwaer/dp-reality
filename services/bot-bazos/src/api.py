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
from .models import BotConfig

logger = logging.getLogger(__name__)


class CreateBody(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    bot_name: str = Field(default="", max_length=200)


class ParseUrlBody(BaseModel):
    url: str = Field(default="", max_length=2048)


_PROPERTY_TYPES = {
    "byt", "dum", "pozemek", "nebytove-prostory", "kancelar",
    "sklad", "obchod", "garaz", "chata", "chalupa", "ostatni",
}


def parse_bazos_url(raw: str) -> dict[str, Any]:
    trimmed = (raw or "").strip()
    if not trimmed:
        return {"ok": False, "reason": "Paste a bazos.cz search URL."}
    parts = urlparse(trimmed)

    host = (parts.hostname or "").lower()
    if not (host == "bazos.cz" or host.endswith(".bazos.cz")):
        return {"ok": False, "reason": "URL must be on bazos.cz."}

    segments = [s for s in parts.path.split("/") if s]
    out: dict[str, Any] = {}
    if segments:
        if segments[0] == "prodam":
            out["category_main"] = "prodam"
        elif segments[0] == "pronajmu":
            out["category_main"] = "pronajmu"
    if len(segments) > 1 and segments[1] in _PROPERTY_TYPES:
        out["category_sub"] = segments[1]

    qs = parse_qs(parts.query)

    cena_od = (qs.get("cenaod") or [""])[0]
    if cena_od:
        n = int(cena_od)
        if n > 0:
            out["price_min"] = n

    cena_do = (qs.get("cenado") or [""])[0]
    if cena_do:
        n = int(cena_do)
        if n > 0:
            out["price_max"] = n

    hlokalita = (qs.get("hlokalita") or [""])[0].strip()
    if hlokalita:
        psc = hlokalita.replace(" ", "")
        if len(psc) != 5 or not psc.isdigit():
            return {"ok": False, "reason": f"hlokalita is not a 5-digit PSČ: {hlokalita!r}"}
        out["psc"] = psc

    humkreis = (qs.get("humkreis") or [""])[0].strip()
    if humkreis:
        km = int(humkreis)
        if not (1 <= km <= 200):
            return {"ok": False, "reason": f"humkreis must be 1–200 km, got {km}"}
        out["radius_km"] = km

    hledat = (qs.get("hledat") or [""])[0].strip()
    if hledat:
        out["keywords"] = hledat

    if not out:
        return {"ok": False, "reason": "Could not extract any filters from this URL."}
    return {"ok": True, "parsed": out}


def _state(request: Request) -> tuple[Any, Any]:
    db = request.app.state.db
    rabbitmq = request.app.state.rabbitmq
    return db, rabbitmq


def build_router() -> APIRouter:
    router = APIRouter()
    configure_html = (Path(__file__).parent / "templates" / "configure.html").read_text(encoding="utf-8")

    @router.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": settings.service_id}

    @router.get("/configure", response_class=HTMLResponse)
    async def configure() -> HTMLResponse:
        return HTMLResponse(configure_html)

    @router.post("/parse-url")
    async def parse_url(body: ParseUrlBody) -> JSONResponse:
        return JSONResponse(parse_bazos_url(body.url))

    @router.get("/location/suggest")
    async def location_suggest(
        request: Request,
        q: str = Query(..., min_length=1, max_length=80),
        limit: int = Query(8, ge=1, le=20),
    ) -> JSONResponse:
        db, _ = _state(request)
        hits = await geo.suggest(db, q, limit=limit)
        return JSONResponse({"results": hits})

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
    if "created_at" in out and hasattr(out["created_at"], "isoformat"):
        out["created_at"] = out["created_at"].isoformat()
    return out


def build_app(
    db: motor.motor_asyncio.AsyncIOMotorDatabase,
    rabbitmq: aio_pika.RobustConnection,
) -> FastAPI:
    app = FastAPI(title="bot-bazos", openapi_url=None, docs_url=None, redoc_url=None)
    app.state.db = db
    app.state.rabbitmq = rabbitmq
    app.include_router(build_router())
    telemetry.instrument_fastapi(app)
    return app

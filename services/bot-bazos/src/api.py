"""HTTP surface of the Bazos bot service.

The whole platform contract for this bot is just five endpoints:

  GET  /healthz               — liveness probe
  GET  /configure             — self-hosted configuration UI (HTML)
  GET  /configs/{config_id}   — read-back for edit-mode pre-fill
  POST /configs/{config_id}   — persist the form's config body, and
                                fire welcome on first creation
  POST /parse-url             — bazos.cz URL → partial config

The reverse proxy at the BFF (/modules/bot-bazos/*) injects the
authenticated `user_id` as a query parameter on every forwarded call.
Lifecycle mutations (pause / resume / delete) are no longer driven by
HTTP or AMQP from the BFF — the BFF writes this bot's config
collection (declared in module_registry.config_collection) directly.
"""
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

from . import repository, welcome
from .config import settings
from .models import BotConfig

logger = logging.getLogger(__name__)


class CreateBody(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    # Forwarded for completeness so the welcome card can address the
    # user's bot by its dashboard name. The bot does not persist this —
    # the BFF stays the sole source of truth for users.bots[].name.
    bot_name: str = Field(default="", max_length=200)


class ParseUrlBody(BaseModel):
    url: str = Field(default="", max_length=2048)


_PROPERTY_TYPES = {
    "byt", "dum", "pozemek", "nebytove-prostory", "kancelar",
    "sklad", "obchod", "garaz", "chata", "chalupa", "ostatni",
}


def parse_bazos_url(raw: str) -> dict[str, Any]:
    """Translate a reality.bazos.cz filter URL into a partial config.

    Returns either {"ok": True, "parsed": {...}} or
    {"ok": False, "reason": "..."}.
    """
    trimmed = (raw or "").strip()
    if not trimmed:
        return {"ok": False, "reason": "Paste a bazos.cz search URL."}
    try:
        parts = urlparse(trimmed)
    except ValueError:
        return {"ok": False, "reason": "That doesn\u2019t look like a valid URL."}

    host = (parts.hostname or "").lower()
    if not (host == "bazos.cz" or host.endswith(".bazos.cz")):
        return {"ok": False, "reason": "URL must be on bazos.cz."}

    segments = [s for s in parts.path.split("/") if s]
    out: dict[str, Any] = {}
    if segments:
        if segments[0] == "prodej":
            out["category_main"] = "prodam"
        elif segments[0] in {"pronajem", "pronajmu"}:
            out["category_main"] = "pronajmu"
    if len(segments) > 1 and segments[1] in _PROPERTY_TYPES:
        out["category_sub"] = segments[1]

    qs = parse_qs(parts.query)
    cena_od = (qs.get("cenaod") or [""])[0]
    cena_do = (qs.get("cenado") or [""])[0]
    if cena_od:
        try:
            n = int(cena_od)
            if n > 0:
                out["price_min"] = n
        except ValueError:
            pass
    if cena_do:
        try:
            n = int(cena_do)
            if n > 0:
                out["price_max"] = n
        except ValueError:
            pass

    psc = (qs.get("hlokalita") or [""])[0]
    if psc:
        out["psc_prefix"] = psc[:5]

    hledat = (qs.get("hledat") or [""])[0].strip()
    if hledat:
        out["title_keywords"] = hledat

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
        # The /modules/* reverse proxy proves the caller's identity by
        # injecting `user_id` from the authenticated session; we refuse
        # to serve another user's config row even if config_id leaked.
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
        # Reject hijack attempts: a client cannot overwrite another
        # user's config row even if they guess the config_id, because
        # `user_id` here came from the proxy / session, not the body.
        existing = await repository.fetch_config(db, config_id)
        if existing and str(existing.get("user_id")) != user_id:
            raise HTTPException(status_code=404, detail="config not found")

        created = await repository.write_config(
            db,
            config_id=config_id,
            user_id=user_id,
            config=cfg.model_dump(mode="json"),
        )
        # Welcome is fired here, only on insert (not on edit), and
        # strictly best-effort — failure to publish does not fail the
        # save. The user's bot is created either way; the welcome
        # email is a courtesy.
        if created:
            try:
                await welcome.emit_welcome(
                    db, rabbitmq,
                    user_id=user_id,
                    config_id=config_id,
                    bot_name=body.bot_name,
                    cfg=cfg,
                )
                await repository.mark_welcome_sent(db, config_id)
            except Exception:
                logger.exception(
                    "welcome publish failed for config %s (continuing)", config_id,
                )
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
    return app

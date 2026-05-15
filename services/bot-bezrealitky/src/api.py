"""HTTP surface of the Bezrealitky bot service.

Mirrors the bot-bazos contract endpoint-for-endpoint:

  GET  /healthz               — liveness probe
  GET  /configure             — self-hosted configuration UI (HTML)
  GET  /configs/{config_id}   — read-back for edit-mode pre-fill
  POST /configs/{config_id}   — persist the form's config body, and
                                fire welcome on first creation
  POST /parse-url             — bezrealitky.cz URL → partial config

The reverse proxy at the BFF (/modules/bot-bezrealitky/*) injects the
authenticated `user_id` as a query parameter on every forwarded call.
Lifecycle mutations (pause / resume / delete) are driven by the BFF
mutating this bot's config collection directly — no HTTP or AMQP
indirection.
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
from .models import BotConfig, PriceType, PropertyType

logger = logging.getLogger(__name__)


class CreateBody(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)
    bot_name: str = Field(default="", max_length=200)


class ParseUrlBody(BaseModel):
    url: str = Field(default="", max_length=2048)


_ESTATE_SLUG_TO_PROPERTY: dict[str, PropertyType] = {
    "byt": PropertyType.APARTMENT,
    "byty": PropertyType.APARTMENT,
    "dum": PropertyType.HOUSE,
    "domy": PropertyType.HOUSE,
    "pozemek": PropertyType.LAND,
    "pozemky": PropertyType.LAND,
    "kancelar": PropertyType.COMMERCIAL,
    "kancelare": PropertyType.COMMERCIAL,
    "nebytovy-prostor": PropertyType.COMMERCIAL,
    "nebytove-prostory": PropertyType.COMMERCIAL,
    "garaz": PropertyType.OTHER,
    "garaze": PropertyType.OTHER,
    "rekreacni-objekt": PropertyType.OTHER,
}


# Bezrealitky exposes both `/nabidka-prodej/...` and `/prodej/...`
# variants depending on entry path; the parser handles either.
_OFFER_SLUG_TO_PRICE: dict[str, PriceType] = {
    "prodej": PriceType.SALE,
    "nabidka-prodej": PriceType.SALE,
    "pronajem": PriceType.RENT,
    "nabidka-pronajem": PriceType.RENT,
}


# Bezrealitky exposes the disposition in URL segments and query
# parameters in two forms: the canonical `2+kk` (matching the listing
# fields stored by the scraper) and the slug-friendly `2-kk`. We
# accept either input and map both to the canonical form so the
# matcher's exact-equality check lines up with the upserted listings.
_DISPOSITION_NORMALISE = {
    "1+kk": "1+kk", "1-kk": "1+kk",
    "1+1": "1+1",
    "2+kk": "2+kk", "2-kk": "2+kk",
    "2+1": "2+1",
    "3+kk": "3+kk", "3-kk": "3+kk",
    "3+1": "3+1",
    "4+kk": "4+kk", "4-kk": "4+kk",
    "4+1": "4+1",
    "5+kk": "5+kk", "5-kk": "5+kk",
    "5+1": "5+1",
    "6+kk": "6+kk", "6-kk": "6+kk",
    "6+1": "6+1",
    "garsoniera": "garsoniera",
    "atypicky": "ostatní",
    "ostatni": "ostatní",
}


def _first(qs: dict[str, list[str]], *names: str) -> str | None:
    """Return the first value for any of the candidate query keys."""
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
    try:
        n = int(cleaned)
    except ValueError:
        return None
    return n if n > 0 else None


def parse_bezrealitky_url(raw: str) -> dict[str, Any]:
    """Translate a bezrealitky.cz filter URL into a partial config.

    Accepts both the current `/vypis/nabidka-prodej/...` form and the
    legacy `/prodej/...` form. Returns either {"ok": True, "parsed":
    {...}} or {"ok": False, "reason": "..."}.
    """
    trimmed = (raw or "").strip()
    if not trimmed:
        return {"ok": False, "reason": "Paste a bezrealitky.cz search URL."}
    try:
        parts = urlparse(trimmed)
    except ValueError:
        return {"ok": False, "reason": "That doesn\u2019t look like a valid URL."}

    host = (parts.hostname or "").lower()
    if not (host == "bezrealitky.cz" or host.endswith(".bezrealitky.cz")):
        return {"ok": False, "reason": "URL must be on bezrealitky.cz."}

    # Strip the optional `vypis` prefix; everything after that is the
    # same `<offer>/<estate>[/<dispozice>][/<lokalita>]` grammar.
    segments = [s for s in parts.path.split("/") if s]
    if segments and segments[0] == "vypis":
        segments = segments[1:]

    out: dict[str, Any] = {}
    if segments:
        price = _OFFER_SLUG_TO_PRICE.get(segments[0])
        if price is not None:
            out["offer_type"] = price.value
    if len(segments) > 1:
        prop = _ESTATE_SLUG_TO_PROPERTY.get(segments[1])
        if prop is not None:
            out["property_type"] = prop.value

    # Disposition can live in a path segment or a query param.
    if len(segments) > 2:
        candidate = segments[2].lower()
        mapped = _DISPOSITION_NORMALISE.get(candidate)
        if mapped:
            out["disposition_in"] = [mapped]

    if len(segments) > 3:
        out["city_contains"] = segments[3].replace("-", " ")

    qs = parse_qs(parts.query)

    price_min = _coerce_int(_first(qs, "cena-od", "cena[od]", "priceFrom", "priceMin"))
    price_max = _coerce_int(_first(qs, "cena-do", "cena[do]", "priceTo", "priceMax"))
    if price_min is not None:
        out["price_min"] = price_min
    if price_max is not None:
        out["price_max"] = price_max

    surface_min = _coerce_int(
        _first(qs, "plocha-od", "surfaceFrom", "surfaceMin")
    )
    surface_max = _coerce_int(
        _first(qs, "plocha-do", "surfaceTo", "surfaceMax")
    )
    if surface_min is not None:
        out["surface_min"] = surface_min
    if surface_max is not None:
        out["surface_max"] = surface_max

    dispo_raw = _first(qs, "dispozice", "disposition")
    if dispo_raw:
        mapped = [
            _DISPOSITION_NORMALISE.get(d.strip().lower())
            for d in dispo_raw.split(",")
        ]
        mapped = [m for m in mapped if m]
        if mapped:
            out["disposition_in"] = list(dict.fromkeys(mapped))

    locality = _first(qs, "lokalita", "region", "city")
    if locality and "city_contains" not in out:
        out["city_contains"] = locality.replace("-", " ")

    keywords = _first(qs, "hledat", "query", "q")
    if keywords:
        out["title_keywords"] = keywords

    if not out:
        return {"ok": False, "reason": "Could not extract any filters from this URL."}
    return {"ok": True, "parsed": out}


def _state(request: Request) -> tuple[Any, Any]:
    db = request.app.state.db
    rabbitmq = request.app.state.rabbitmq
    return db, rabbitmq


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
    app = FastAPI(
        title="bot-bezrealitky", openapi_url=None, docs_url=None, redoc_url=None
    )
    app.state.db = db
    app.state.rabbitmq = rabbitmq
    app.include_router(build_router())
    return app

"""gRPC BotModule server for the Bazos module."""

import json
import logging
import re
from concurrent import futures
from datetime import datetime, timedelta, UTC
from urllib.parse import urlparse, parse_qs

import grpc
from pymongo.database import Database

import bot_module_pb2 as pb2
import bot_module_pb2_grpc as pb2_grpc
from manifest import MANIFEST

logger = logging.getLogger(__name__)

SOURCE = "bazos"

TRANSACTION_MAP = {
    "prodam": "sale",
    "pronajem": "rent",
    "prenajmu": "rent",
}

TYPE_MAP = {
    "byt": "apartment",
    "bytu": "apartment",
    "dum": "house",
    "domu": "house",
    "pozemek": "land",
    "pozemku": "land",
}

CONFIG_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "name": {"type": "string", "title": "Bot name"},
        "cities": {"type": "array", "items": {"type": "string"}, "title": "Cities"},
        "property_types": {
            "type": "array",
            "items": {"type": "string", "enum": ["apartment", "house", "land"]},
            "title": "Property types",
        },
        "price_types": {
            "type": "array",
            "items": {"type": "string", "enum": ["sale", "rent"]},
            "title": "Transaction type",
        },
        "min_price": {"type": "integer", "title": "Min price (CZK)", "minimum": 0},
        "max_price": {"type": "integer", "title": "Max price (CZK)", "minimum": 0},
        "dispositions": {
            "type": "array",
            "items": {"type": "string"},
            "title": "Dispositions (e.g. 2+kk)",
        },
    },
    "required": ["name"],
})


class BotModuleServicer(pb2_grpc.BotModuleServicer):
    def __init__(self, db: Database):
        self._col = db["reality"]

    def GetManifest(self, request, context):
        return pb2.Manifest(
            id=MANIFEST["module_id"],
            display_name=MANIFEST["display_name"],
            description=MANIFEST["description"],
            icon_url=MANIFEST["icon_url"],
            url_patterns=MANIFEST["url_patterns"],
        )

    def ParseUrl(self, request, context):
        raw = (request.url or "").strip()
        try:
            parsed = urlparse(raw)
        except Exception:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Invalid URL")
            return pb2.ParseUrlResponse()

        segments = [s for s in parsed.path.strip("/").split("/") if s]
        qs = parse_qs(parsed.query)
        warnings: list[str] = []
        price_types: list[str] = []
        property_types: list[str] = []
        cities: list[str] = []

        if segments:
            tx = TRANSACTION_MAP.get(segments[0])
            if tx:
                price_types = [tx]
            else:
                warnings.append(f'Unknown transaction segment "{segments[0]}"')

        if len(segments) > 1:
            pt = TYPE_MAP.get(segments[1])
            if pt:
                property_types = [pt]
            else:
                warnings.append(f'Unknown property type segment "{segments[1]}"')

        if len(segments) > 2:
            cities = [segments[2].replace("-", " ").title()]

        min_price = None
        max_price = None
        if "cenaod" in qs:
            v = int(qs["cenaod"][0]) if qs["cenaod"][0].isdigit() else None
            if v and v > 0:
                min_price = v
        if "cenado" in qs:
            v = int(qs["cenado"][0]) if qs["cenado"][0].isdigit() else None
            if v and v > 0:
                max_price = v

        locality = qs.get("hlokalita", [None])[0]
        if locality and not cities:
            warnings.append(
                f'Locality code "{locality}" could not be mapped to a city name '
                "— please fill it in manually"
            )

        parts = [", ".join(cities), "/".join(property_types), "/".join(price_types)]
        name = " — ".join(p for p in parts if p) or "Bazos bot"

        resp = pb2.ParseUrlResponse(
            name=name,
            cities=cities,
            property_types=property_types,
            price_types=price_types,
            dispositions=[],
            warnings=warnings,
        )
        if min_price is not None:
            resp.min_price = min_price
        if max_price is not None:
            resp.max_price = max_price
        return resp

    def GetConfigSchema(self, request, context):
        return pb2.ConfigSchema(json_schema=CONFIG_SCHEMA)

    def GetOverview(self, request, context):
        cutoff = datetime.now(UTC) - timedelta(hours=24)
        total = self._col.count_documents({"source": SOURCE})
        new_24h = self._col.count_documents(
            {"source": SOURCE, "first_seen": {"$gte": cutoff}}
        )

        top_cities = list(self._col.aggregate([
            {"$match": {"source": SOURCE}},
            {"$group": {"_id": "$city", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
        ]))
        top_types = list(self._col.aggregate([
            {"$match": {"source": SOURCE}},
            {"$group": {"_id": "$property_type", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
        ]))

        return pb2.OverviewResponse(
            total_listings=total,
            new_last_24h=new_24h,
            top_cities=[
                pb2.StatByField(label=c["_id"] or "Unknown", count=c["count"])
                for c in top_cities
            ],
            top_types=[
                pb2.StatByField(label=t["_id"] or "Unknown", count=t["count"])
                for t in top_types
            ],
            extra_html="",
        )


def serve_grpc(db: Database, port: int = 50051):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    pb2_grpc.add_BotModuleServicer_to_server(BotModuleServicer(db), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    logger.info("gRPC server listening on :%d", port)
    return server

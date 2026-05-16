from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class GeoClient:
    """Thin async wrapper around the geo-cz service.

    Errors propagate by design: a failed geo lookup means the matcher
    cannot honour the user's radius filter, and silently treating it as
    "match everything" or "match nothing" would both be wrong.
    """

    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or settings.geo_service_url).rstrip("/")

    async def in_radius_by_psc(self, psc: str, radius_km: int) -> set[str]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{self._base_url}/in-radius",
                json={"psc": psc, "radius_km": radius_km},
            )
            response.raise_for_status()
            data = response.json()
        return set(data.get("psc") or [])

    async def resolve_city(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{self._base_url}/city/resolve",
                params={"q": query, "limit": limit},
            )
            if response.status_code == 404:
                return []
            response.raise_for_status()
            return response.json().get("results", [])

    async def get_psc(self, psc: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{self._base_url}/psc/{psc}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()


geo_client = GeoClient()

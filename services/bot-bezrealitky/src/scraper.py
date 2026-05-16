"""Bezrealitky scraper — GraphQL only.

Two operations against the public bezrealitky GraphQL endpoint:
  - `AdvertList`   paginated summaries with everything the matcher
                   needs (gps, condition, ownership, ...). Detail is
                   fetched only for newly-inserted listings to keep
                   the per-cycle traffic predictable.
  - `AdvertDetail` description, energy class, extra photos.

Anti-bot countermeasures (NFR-01-B): per-page throttle and a small
header-profile pool rotated round-robin. On a 429/403 the cycle aborts
and the scheduler backs off `settings.backoff_minutes_on_block`.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from itertools import cycle as iter_cycle
from typing import Any, Iterator

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import settings
from .models import (
    Condition,
    Disposition,
    EstateType,
    GeoPoint,
    Listing,
    OfferType,
    Ownership,
    disposition_label,
    estate_to_property,
    offer_to_price,
)

logger = logging.getLogger(__name__)

GRAPHQL_ENDPOINT = "https://api.bezrealitky.cz/graphql/"
DETAIL_URL_PREFIX = "https://www.bezrealitky.cz/nemovitosti-byty-domy/"

# Required by nginx WAF — without Origin + Referer the endpoint 403s.
_STATIC_HEADERS = {
    "Origin": "https://www.bezrealitky.cz",
    "Referer": "https://www.bezrealitky.cz/",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


class _BlockedError(RuntimeError):
    """Bezrealitky returned 429 or 403 — abort the cycle and back off."""


class _TransientHttp(RuntimeError):
    """5xx — retry within the same cycle, do not back off."""


# (offer_type, estate_type) tuples scraped per cycle.
_CATEGORY_MATRIX: list[tuple[OfferType, EstateType]] = [
    (OfferType.PRODEJ, EstateType.BYT),
    (OfferType.PRODEJ, EstateType.DUM),
    (OfferType.PRONAJEM, EstateType.BYT),
    (OfferType.PRONAJEM, EstateType.DUM),
    (OfferType.PRODEJ, EstateType.POZEMEK),
    (OfferType.PRONAJEM, EstateType.POZEMEK),
]


@dataclass(frozen=True)
class _ListSummary:
    advert_id: str
    uri: str
    estate_type: str
    offer_type: str
    disposition: str | None
    address: str | None
    surface: int | None
    price: int | None
    currency: str | None
    main_image_url: str | None
    gps_lat: float | None
    gps_lng: float | None
    condition: str | None
    ownership: str | None
    street: str | None
    zip: str | None


def _header_profile_iter() -> Iterator[dict[str, str]]:
    return iter_cycle(settings.header_profiles)


_PROFILE_ITER = _header_profile_iter()


def _next_headers() -> dict[str, str]:
    return {**_STATIC_HEADERS, **next(_PROFILE_ITER)}


_LIST_QUERY = """
query AdvertList(
  $locale: Locale!
  $estateType: [EstateType]
  $offerType: [OfferType]
  $limit: Int = 30
  $offset: Int = 0
  $order: ResultOrder = TIMEORDER_DESC
) {
  listAdverts(
    offerType: $offerType
    estateType: $estateType
    limit: $limit
    offset: $offset
    order: $order
  ) {
    list {
      id
      uri
      estateType
      offerType
      disposition
      address(locale: $locale)
      surface
      price
      currency
      condition
      ownership
      street
      zip
      gps { lat lng }
      mainImage { url(filter: RECORD_MAIN) }
    }
  }
}
"""

_DETAIL_QUERY = """
query AdvertDetailLite($id: ID!, $locale: Locale!) {
  advert(id: $id) {
    id
    description
    descriptionByLocale(locale: $locale)
    penb
    city(locale: $locale)
    publicImages(limit: 4) { url(filter: RECORD_MAIN) }
  }
}
"""


async def _post_graphql(
    client: httpx.AsyncClient,
    *,
    operation: str,
    query: str,
    variables: dict[str, Any],
) -> dict[str, Any]:
    payload = {"operationName": operation, "variables": variables, "query": query}
    async for attempt in AsyncRetrying(
        retry=retry_if_exception_type((httpx.TransportError, _TransientHttp)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    ):
        with attempt:
            response = await client.post(
                GRAPHQL_ENDPOINT,
                json=payload,
                headers=_next_headers(),
                timeout=30,
            )
            status = response.status_code
            if status in (429, 403):
                raise _BlockedError(f"bezrealitky returned {status} for {operation}")
            if 500 <= status < 600:
                raise _TransientHttp(f"HTTP {status} from {operation}")
            response.raise_for_status()
            body = response.json()
            if body.get("errors"):
                raise RuntimeError(f"GraphQL errors on {operation}: {body['errors']}")
            return body.get("data") or {}
    raise RuntimeError("unreachable")


def _parse_address(raw: str | None) -> tuple[str | None, str | None]:
    if not raw:
        return None, None
    bits = [b.strip() for b in raw.split(",") if b.strip()]
    if not bits:
        return None, None
    locality = bits[-1]
    if " - " in locality:
        city, district = locality.split(" - ", 1)
        return city.strip() or None, district.strip() or None
    return locality or None, None


def _build_title(
    address: str | None,
    estate_type: EstateType,
    offer_type: OfferType,
    disposition: Disposition | None,
) -> str:
    offer_label = "Sale of" if offer_type == OfferType.PRODEJ else "Rent of"
    estate_label = {
        EstateType.BYT: "apartment",
        EstateType.DUM: "house",
        EstateType.POZEMEK: "land",
        EstateType.GARAZ: "garage",
        EstateType.KANCELAR: "office",
        EstateType.NEBYTOVY_PROSTOR: "non-residential",
        EstateType.REKREACNI_OBJEKT: "leisure property",
    }.get(estate_type, "property")
    parts = [f"{offer_label} {estate_label}"]
    label = disposition_label(disposition)
    if label:
        parts.append(label)
    if address:
        parts.append(address)
    return " — ".join(parts)


def _enum(value: str | None, enum_cls: type) -> Any:
    if not value or value == "UNDEFINED":
        return None
    try:
        return enum_cls(value)
    except ValueError:
        return None


def _summary_to_listing(summary: _ListSummary) -> Listing | None:
    estate = _enum(summary.estate_type, EstateType)
    offer = _enum(summary.offer_type, OfferType)
    if estate is None or offer is None:
        return None
    disposition = _enum(summary.disposition, Disposition)
    city, district = _parse_address(summary.address)
    title = _build_title(summary.address, estate, offer, disposition)

    gps: GeoPoint | None = None
    if summary.gps_lat is not None and summary.gps_lng is not None:
        gps = GeoPoint(coordinates=[summary.gps_lng, summary.gps_lat])

    photos = [summary.main_image_url] if summary.main_image_url else []

    return Listing(
        title=title,
        property_type=estate_to_property(estate),
        disposition=disposition_label(disposition),
        price=summary.price if summary.price and summary.price > 0 else None,
        price_type=offer_to_price(offer),
        city=city,
        district=district,
        source_url=_source_url(summary.uri, summary.advert_id),
        source_id=summary.advert_id,
        estate_type=estate,
        offer_type=offer,
        disposition_native=disposition,
        ownership=_enum(summary.ownership, Ownership),
        condition=_enum(summary.condition, Condition),
        currency=summary.currency or "CZK",
        surface_m2=int(summary.surface) if summary.surface else None,
        street=summary.street or None,
        zip_code=(summary.zip or "").replace(" ", "") or None,
        photos=photos,
        gps=gps,
    )


def _source_url(uri: str | None, advert_id: str) -> str:
    return f"{DETAIL_URL_PREFIX}{uri or advert_id}"


async def _fetch_category_page(
    client: httpx.AsyncClient,
    *,
    offer_type: OfferType,
    estate_type: EstateType,
    page: int,
) -> list[_ListSummary]:
    variables = {
        "locale": "CS",
        "estateType": [estate_type.value],
        "offerType": [offer_type.value],
        "limit": settings.scrape_page_size,
        "offset": page * settings.scrape_page_size,
        "order": "TIMEORDER_DESC",
    }
    data = await _post_graphql(
        client, operation="AdvertList", query=_LIST_QUERY, variables=variables
    )
    raw_list = ((data.get("listAdverts") or {}).get("list") or [])
    out: list[_ListSummary] = []
    for item in raw_list:
        if not item or not item.get("id"):
            continue
        gps = item.get("gps") or {}
        out.append(
            _ListSummary(
                advert_id=str(item["id"]),
                uri=item.get("uri") or "",
                estate_type=item.get("estateType") or "",
                offer_type=item.get("offerType") or "",
                disposition=item.get("disposition"),
                address=item.get("address"),
                surface=item.get("surface"),
                price=item.get("price"),
                currency=item.get("currency"),
                main_image_url=(item.get("mainImage") or {}).get("url"),
                gps_lat=gps.get("lat"),
                gps_lng=gps.get("lng"),
                condition=item.get("condition"),
                ownership=item.get("ownership"),
                street=item.get("street"),
                zip=item.get("zip"),
            )
        )
    return out


async def fetch_listings() -> list[Listing]:
    seen: set[str] = set()
    out: list[Listing] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for offer_type, estate_type in _CATEGORY_MATRIX:
            for page in range(settings.scrape_pages):
                page_items = await _fetch_category_page(
                    client, offer_type=offer_type, estate_type=estate_type, page=page
                )
                if not page_items:
                    break
                for summary in page_items:
                    if summary.advert_id in seen:
                        continue
                    listing = _summary_to_listing(summary)
                    if listing is None:
                        continue
                    seen.add(summary.advert_id)
                    out.append(listing)
                await asyncio.sleep(settings.scrape_throttle_seconds_between_pages)
    return out


async def enrich_with_detail(listings: list[Listing]) -> None:
    """Detail-fetch up to `max_detail_fetches_per_cycle` listings.

    Best-effort: a `_BlockedError` here only stops the enrichment phase
    (summaries are already persisted by the cycle); other failures
    propagate.
    """
    if not listings:
        return
    budget = min(len(listings), settings.max_detail_fetches_per_cycle)
    if budget == 0:
        return

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for listing in listings[:budget]:
            try:
                await _enrich_one(client, listing)
            except _BlockedError:
                logger.warning("detail enrichment blocked, stopping enrichment phase")
                return
            await asyncio.sleep(settings.scrape_throttle_seconds_between_pages)


async def _enrich_one(client: httpx.AsyncClient, listing: Listing) -> None:
    data = await _post_graphql(
        client,
        operation="AdvertDetailLite",
        query=_DETAIL_QUERY,
        variables={"id": listing.source_id, "locale": "CS"},
    )
    advert = data.get("advert")
    if not advert:
        return

    description = advert.get("descriptionByLocale") or advert.get("description")
    if description:
        listing.description = description.strip() or None

    penb = advert.get("penb")
    if penb and penb != "UNDEFINED":
        listing.energy_class = penb

    city = (advert.get("city") or "").strip()
    if city:
        listing.city = city

    photos = list(listing.photos)
    for img in advert.get("publicImages") or []:
        url = (img or {}).get("url")
        if url and url not in photos:
            photos.append(url)
    listing.photos = photos

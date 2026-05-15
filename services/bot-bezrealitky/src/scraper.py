"""Bezrealitky scraper.

Endpoint (discovered 2026-05-15 by inspecting the bezrealitky.cz
production bundle — `_app-*.js` ships an Apollo client wired to
`https://api.bezrealitky.cz/graphql/`):

    POST https://api.bezrealitky.cz/graphql/
    Required headers: Origin: https://www.bezrealitky.cz
                     Referer: https://www.bezrealitky.cz/
                     a realistic browser User-Agent
                     (omitting any of these returns 403 from nginx)

    body: {operationName, variables, query}

Two operations are used:

  - `AdvertList`           paginated summaries (id, uri, address,
                           surface, price, disposition, estateType,
                           offerType, mainImage). The list response
                           is enough to detect new listings and to
                           seed the analytics base schema.
  - `AdvertDetail`         per-listing description + energy class +
                           postal code + extra photos. The thesis
                           §4.3.2 mandates a hybrid acquisition
                           strategy: detail fetches happen only for
                           NEW listings (post-upsert), throttled and
                           rate-limited per cycle.

Anti-bot countermeasures (thesis NFR-01-B): every outbound request
rotates through a small header-profile pool (User-Agent +
Accept-Language) round-robin, and successive list-page fetches sleep
`settings.scrape_throttle_seconds_between_pages`. On a 429 / 403 the
cycle aborts and the orchestrator skips ahead per
`settings.backoff_minutes_on_block`.
"""
from __future__ import annotations

import asyncio
import logging
import re
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
from .models import Listing, PriceType, PropertyType


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


# Mapping of Bezrealitky enums to the platform's normalised vocabulary.
_ESTATE_TO_PROPERTY: dict[str, PropertyType] = {
    "BYT": PropertyType.APARTMENT,
    "DUM": PropertyType.HOUSE,
    "POZEMEK": PropertyType.LAND,
    "GARAZ": PropertyType.OTHER,
    "KANCELAR": PropertyType.COMMERCIAL,
    "NEBYTOVY_PROSTOR": PropertyType.COMMERCIAL,
    "REKREACNI_OBJEKT": PropertyType.OTHER,
}

_OFFER_TO_PRICE: dict[str, PriceType] = {
    "PRODEJ": PriceType.SALE,
    "PRONAJEM": PriceType.RENT,
}

# Source enum -> short human label used on cards / matcher comparisons.
_DISPOSITION_LABELS: dict[str, str] = {
    "GARSONIERA": "garsoniera",
    "DISP_1_KK": "1+kk",
    "DISP_1_1": "1+1",
    "DISP_1_IZB": "1+iz",
    "DISP_2_KK": "2+kk",
    "DISP_2_1": "2+1",
    "DISP_2_IZB": "2+iz",
    "DISP_3_KK": "3+kk",
    "DISP_3_1": "3+1",
    "DISP_3_IZB": "3+iz",
    "DISP_4_KK": "4+kk",
    "DISP_4_1": "4+1",
    "DISP_4_IZB": "4+iz",
    "DISP_5_KK": "5+kk",
    "DISP_5_1": "5+1",
    "DISP_5_IZB": "5+iz",
    "DISP_6_KK": "6+kk",
    "DISP_6_1": "6+1",
    "DISP_6_IZB": "6+iz",
    "DISP_7_KK": "7+kk",
    "DISP_7_1": "7+1",
    "DISP_7_IZB": "7+iz",
    "OSTATNI": "ostatní",
}


# Category matrix to walk per cycle. Trimmed to the four primary
# combinations that account for the bulk of Bezrealitky inventory; the
# other estate types (land, commercial) can be added in a follow-up
# without schema churn.
_CATEGORY_MATRIX: list[tuple[str, str]] = [
    ("PRODEJ", "BYT"),
    ("PRODEJ", "DUM"),
    ("PRONAJEM", "BYT"),
    ("PRONAJEM", "DUM"),
    ("PRODEJ", "POZEMEK"),
    ("PRONAJEM", "POZEMEK"),
]


@dataclass(frozen=True)
class _ListSummary:
    """Raw projection from the AdvertList response."""

    advert_id: str
    uri: str
    estate_type: str
    offer_type: str
    disposition: str | None
    address: str | None
    surface: int | None
    price: int | None
    main_image_url: str | None


# Round-robin iterator over the configured header profiles. Module-level
# so the rotation is stable across scrape cycles within the same
# process — this avoids a fresh process always picking profile 0, which
# would defeat the rotation against any client-side fingerprint cache
# bezrealitky.cz may keep.
def _header_profile_iter() -> Iterator[dict[str, str]]:
    return iter_cycle(settings.header_profiles)


_PROFILE_ITER = _header_profile_iter()


def _next_headers() -> dict[str, str]:
    profile = next(_PROFILE_ITER)
    return {**_STATIC_HEADERS, **profile}


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
      mainImage { id url(filter: RECORD_MAIN) }
    }
    totalCount
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
    street
    zip
    city(locale: $locale)
    surface
    mainImage { url(filter: RECORD_MAIN) }
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
    """One GraphQL POST with header rotation + retry on transient errors.

    Raises `_BlockedError` on 429/403 so the cycle layer can react with
    a long backoff (different code path from a generic network blip).
    """
    payload = {
        "operationName": operation,
        "variables": variables,
        "query": query,
    }

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
                raise _BlockedError(
                    f"bezrealitky returned {status} for {operation}"
                )
            if 500 <= status < 600:
                raise _TransientHttp(f"HTTP {status} from {operation}")
            response.raise_for_status()
            body = response.json()
            if body.get("errors"):
                logger.warning(
                    "GraphQL errors on %s: %s", operation, body["errors"]
                )
            return body.get("data") or {}

    # Unreachable — AsyncRetrying with reraise=True either returns or
    # propagates the last exception. The explicit raise satisfies type
    # checkers without changing runtime behaviour.
    raise RuntimeError("unreachable")


class _TransientHttp(RuntimeError):
    """5xx — retry within the same cycle, do not back off."""


def _parse_disposition(raw: str | None) -> str | None:
    if not raw or raw == "UNDEFINED":
        return None
    return _DISPOSITION_LABELS.get(raw)


def _parse_address(raw: str | None) -> tuple[str | None, str | None]:
    """Bezrealitky's `address` collapses 'Street, City - District'.

    We split on the last comma: the city block is to the right, the
    street/POI to the left (ignored here — the structured `street`
    field lives on the detail response, not the list). The "City -
    District" half is split on the en-dash with spaces around it.
    """
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


_ID_FROM_URI_RE = re.compile(r"^(\d+)-")


def _source_url_from_uri(uri: str | None, advert_id: str) -> str:
    """Bezrealitky detail URLs are `nemovitosti-byty-domy/<uri>`.

    `uri` is the SEO slug bundled with the advert id; falling back to
    the bare id keeps the URL functional even if the slug is missing.
    """
    if uri:
        return f"{DETAIL_URL_PREFIX}{uri}"
    return f"{DETAIL_URL_PREFIX}{advert_id}"


def _build_title(
    address: str | None,
    estate_type: str,
    offer_type: str,
    disposition: str | None,
) -> str:
    """Compose a human-readable title from the list-response fields.

    The list endpoint does not return an editorial title — Bezrealitky
    constructs theirs in the frontend as "<Offer> <Estate>, <Address>".
    We mirror that pattern so the inbox tile has a sensible heading.
    """
    parts: list[str] = []
    offer_label = "Sale of" if offer_type == "PRODEJ" else "Rent of"
    estate_label = {
        "BYT": "apartment",
        "DUM": "house",
        "POZEMEK": "land",
        "GARAZ": "garage",
        "KANCELAR": "office",
        "NEBYTOVY_PROSTOR": "non-residential",
        "REKREACNI_OBJEKT": "leisure property",
    }.get(estate_type, "property")
    parts.append(f"{offer_label} {estate_label}")
    if disposition:
        parts.append(disposition)
    if address:
        parts.append(address)
    return " — ".join(parts)


def _summary_to_listing(summary: _ListSummary) -> Listing | None:
    estate = _ESTATE_TO_PROPERTY.get(summary.estate_type)
    offer = _OFFER_TO_PRICE.get(summary.offer_type)
    if estate is None or offer is None:
        return None

    disposition = _parse_disposition(summary.disposition)
    city, district = _parse_address(summary.address)
    title = _build_title(
        summary.address, summary.estate_type, summary.offer_type, disposition
    )
    photos = [summary.main_image_url] if summary.main_image_url else []

    return Listing(
        title=title,
        property_type=estate,
        disposition=disposition,
        price=summary.price if summary.price and summary.price > 0 else None,
        price_type=offer,
        city=city,
        district=district,
        source_url=_source_url_from_uri(summary.uri, summary.advert_id),
        source_id=summary.advert_id,
        description=None,
        surface_m2=int(summary.surface) if summary.surface else None,
        energy_class=None,
        offer_type=offer,
        photos=photos,
    )


async def _fetch_category_page(
    client: httpx.AsyncClient,
    *,
    offer_type: str,
    estate_type: str,
    page: int,
) -> list[_ListSummary]:
    """Fetch one page of the (offer, estate) category."""
    variables = {
        "locale": "CS",
        "estateType": [estate_type],
        "offerType": [offer_type],
        "limit": settings.scrape_page_size,
        "offset": page * settings.scrape_page_size,
        "order": "TIMEORDER_DESC",
    }
    data = await _post_graphql(
        client,
        operation="AdvertList",
        query=_LIST_QUERY,
        variables=variables,
    )
    raw_list = (((data or {}).get("listAdverts") or {}).get("list") or [])
    out: list[_ListSummary] = []
    for item in raw_list:
        if not item or not item.get("id"):
            continue
        main_image = item.get("mainImage") or {}
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
                main_image_url=main_image.get("url"),
            )
        )
    return out


async def fetch_listings() -> list[Listing]:
    """Walk the category matrix and return deduplicated `Listing` rows.

    Raises `_BlockedError` if Bezrealitky pushed back hard enough to
    warrant a backoff — the cycle layer translates that into a longer
    pause before the next attempt.
    """
    seen: set[str] = set()
    out: list[Listing] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for offer_type, estate_type in _CATEGORY_MATRIX:
            for page in range(settings.scrape_pages):
                try:
                    page_items = await _fetch_category_page(
                        client,
                        offer_type=offer_type,
                        estate_type=estate_type,
                        page=page,
                    )
                except _BlockedError:
                    raise
                except Exception as exc:
                    logger.warning(
                        "list fetch failed (%s/%s page %d): %s",
                        offer_type,
                        estate_type,
                        page,
                        exc,
                    )
                    break
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
                await asyncio.sleep(
                    settings.scrape_throttle_seconds_between_pages
                )

    return out


async def enrich_with_detail(listings: list[Listing]) -> None:
    """Detail-fetch up to `max_detail_fetches_per_cycle` listings.

    Mutates each listing in place: sets `description`, `energy_class`,
    augments `photos`, and refines `city` when the detail response
    provides a cleaner value than the list-page address split. Beyond
    the cap, listings stay summary-only; they'll be enriched the next
    cycle (or stay summary-only if the cycle never picks them up
    again, which is acceptable — the card still renders).
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
                # Detail enrichment is best-effort: a block here is not
                # worth aborting the cycle (the summaries are already
                # in Mongo). We propagate up only if list fetching
                # tripped the same condition.
                logger.warning("detail enrichment blocked, stopping")
                return
            except Exception as exc:
                logger.warning(
                    "detail fetch failed for %s: %s", listing.source_id, exc
                )
            await asyncio.sleep(settings.scrape_throttle_seconds_between_pages)


async def _enrich_one(client: httpx.AsyncClient, listing: Listing) -> None:
    data = await _post_graphql(
        client,
        operation="AdvertDetailLite",
        query=_DETAIL_QUERY,
        variables={"id": listing.source_id, "locale": "CS"},
    )
    advert = (data or {}).get("advert")
    if not advert:
        return

    description = (
        advert.get("descriptionByLocale")
        or advert.get("description")
        or None
    )
    if description:
        listing.description = description.strip() or None

    penb = advert.get("penb")
    if penb and penb != "UNDEFINED":
        listing.energy_class = penb

    zip_code = (advert.get("zip") or "").strip()
    if zip_code and not listing.district:
        listing.district = zip_code[:3]

    city = (advert.get("city") or "").strip()
    if city:
        listing.city = city

    if advert.get("surface") and not listing.surface_m2:
        listing.surface_m2 = int(advert["surface"])

    photos: list[str] = list(listing.photos)
    main = (advert.get("mainImage") or {}).get("url")
    if main and main not in photos:
        photos.insert(0, main)
    for img in advert.get("publicImages") or []:
        url = (img or {}).get("url")
        if url and url not in photos:
            photos.append(url)
    listing.photos = photos

"""Bazos list-page scraper.

Deliberately scrapes the public HTML list pages and nothing else:
 * No per-listing detail fetches (respectful + fast + no session).
 * No cross-source normalisation — the `bazos` collection stores what
   the list page actually shows; downstream (module `.mjs`) decides
   what `URL → matcher` translation looks like.

Bazos individual listings are served under `/inzerat/<id>/<slug>.php`
regardless of their transaction/property category, so the listing URL
itself carries no category signal. To recover `price_type` and
`property_type` we crawl a per-category matrix of list pages
(`/prodam/<sub>/`, `/pronajem/<sub>/`) and take the category from the
*page URL* we're reading, not from the listing href.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag

from models import Listing, PriceType, PropertyType

BASE_URL = "https://reality.bazos.cz/"
_INZERAT_ID_RE = re.compile(r"^/inzerat/(\d+)/")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

logger = logging.getLogger(__name__)


# ---------- URL-slug → coarse-bucket mapping ----------

_CATEGORY_MAIN_TO_PRICE: dict[str, PriceType] = {
    "prodam": PriceType.SALE,
    # Bazos uses the first-person verb form `pronajmu` ("I'm renting")
    # in rent list URLs — NOT the noun `pronajem`. Using the noun yields
    # HTTP 404 with a soft fallback to the homepage, which is the
    # classic way to mis-ingest every rent listing as a sale. Keep this
    # slug in sync with `LISTING_TYPE_TO_MAIN` in the bazos module.
    "pronajmu": PriceType.RENT,
}

# Everything the Bazos reality router accepts as segment 2. Only slugs
# in this table are recognised as listings; unknown slugs are skipped
# (safer than guessing — Bazos has occasionally added niche subcats).
_CATEGORY_SUB_TO_PROPERTY: dict[str, PropertyType] = {
    "byt": PropertyType.APARTMENT,
    "dum": PropertyType.HOUSE,
    "pozemek": PropertyType.LAND,
    "nebytove-prostory": PropertyType.COMMERCIAL,
    "kancelar": PropertyType.COMMERCIAL,
    "sklad": PropertyType.COMMERCIAL,
    "obchod": PropertyType.COMMERCIAL,
    "garaz": PropertyType.OTHER,
    "chata": PropertyType.OTHER,
    "chalupa": PropertyType.OTHER,
    "ostatni": PropertyType.OTHER,
}

# Matches a Czech postal code (`XXXX X` with optional whitespace).
# Anchored at the end of the locality string because the city often
# appears immediately before the PSČ with no delimiter (e.g.
# "Jičín508 01").
_PSC_PATTERN = re.compile(r"(\d{3})\s*(\d{2})\s*$")
# NOTE: we deliberately do **not** parse "disposition" (1+kk/3+1/…) here.
# Bazos list pages don't expose a structured disposition column — the
# token only shows up when a seller happened to type it into the title.
# Fishing it out of free text produces a field that looks structured but
# reflects seller copywriting habits, not Bazos's own taxonomy, so bots
# can't rely on it. Sreality, by contrast, exposes disposition as a
# canonical `category_sub_cb` code and keeps its own `disposition`.


@dataclass(frozen=True)
class _CategoryCursor:
    """One cell in the scrape matrix: a Bazos transaction + property
    category whose list page we're about to fetch. `price_type` and
    `property_type` are derived here so each parsed row inherits the
    cursor's category regardless of what its `/inzerat/...` URL says.
    """
    category_main: str   # "prodam" | "pronajem"
    category_sub: str    # "byt", "dum", ...
    price_type: PriceType
    property_type: PropertyType


def _build_category_matrix() -> list[_CategoryCursor]:
    """Cartesian product of transactions × property subcategories we
    recognise. A handful of combos (e.g. pronajem/pozemek) 404 on
    Bazos — we still emit a cursor for them and let the fetcher skip
    non-200 responses, rather than hard-code the exclusions here.
    """
    return [
        _CategoryCursor(main, sub, price_type, property_type)
        for main, price_type in _CATEGORY_MAIN_TO_PRICE.items()
        for sub, property_type in _CATEGORY_SUB_TO_PROPERTY.items()
    ]


def _parse_price(raw: str) -> int | None:
    """Strip everything except digits. Returns None for free-text
    prices like "V textu" or "Dohodou".
    """
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


def _parse_listing_id(href: str) -> str | None:
    """Bazos ad URLs are `/inzerat/<id>/<slug>.php`. Anything else
    (category index, admin pages, external links) is skipped.
    """
    match = _INZERAT_ID_RE.match(href)
    return match.group(1) if match else None


def _parse_locality(raw: str) -> tuple[str | None, str | None]:
    """Returns `(city, psc)`. The locality cell on Bazos lists the
    city concatenated with the postal code (e.g. "Brno614 00") so we
    anchor on the 5-digit PSČ at the end and treat the rest as city.
    """
    text = raw.strip()
    if not text:
        return None, None
    match = _PSC_PATTERN.search(text)
    if not match:
        return text or None, None
    psc = f"{match.group(1)}{match.group(2)}"
    city = text[: match.start()].strip(" ,;") or None
    return city, psc


def _text(element: Tag | None) -> str:
    return element.get_text(strip=True) if element else ""


def _parse_listing(element: Tag, cursor: _CategoryCursor) -> Listing | None:
    title_link = element.select_one("h2.nadpis a")
    if not title_link:
        return None

    href = title_link.get("href", "")
    if not isinstance(href, str):
        return None
    source_id = _parse_listing_id(href)
    if source_id is None:
        return None

    title = _text(title_link)
    if not title:
        return None

    description = _text(element.find(class_="popis")) or None
    price_raw = _text(element.find(class_="inzeratycena"))
    locality_raw_el = element.find(class_="inzeratylok")
    locality_raw = (
        locality_raw_el.get_text(separator=" ", strip=True)
        if locality_raw_el
        else ""
    )
    city, psc = _parse_locality(locality_raw)

    return Listing(
        source_id=source_id,
        title=title,
        description=description,
        price=_parse_price(price_raw),
        price_type=cursor.price_type,
        property_type=cursor.property_type,
        category_main=cursor.category_main,
        category_sub=cursor.category_sub,
        psc=psc,
        city=city,
        locality_raw=locality_raw or None,
        url=BASE_URL.rstrip("/") + href,
    )


def _category_page_url(cursor: _CategoryCursor, page: int) -> str:
    """Bazos paginates with a numeric offset appended to the path. The
    first page is the bare `/<main>/<sub>/`; subsequent pages use
    `/<main>/<sub>/<offset>/`.
    """
    base = f"{BASE_URL}{cursor.category_main}/{cursor.category_sub}/"
    return base if page == 0 else f"{base}{page * 20}/"


def _deduplicate(listings: Iterable[Listing]) -> list[Listing]:
    """Dedup by `source_id`. When the same ad surfaces under multiple
    category cursors (it shouldn't, but Bazos occasionally cross-lists),
    the first cursor's categorisation wins.
    """
    seen: set[str] = set()
    out: list[Listing] = []
    for listing in listings:
        if listing.source_id in seen:
            continue
        seen.add(listing.source_id)
        out.append(listing)
    return out


async def _scrape_category(
    client: httpx.AsyncClient, cursor: _CategoryCursor, pages: int
) -> list[Listing]:
    collected: list[Listing] = []
    for page in range(pages):
        url = _category_page_url(cursor, page)
        try:
            response = await client.get(url)
        except httpx.HTTPError as exc:
            logger.warning("HTTP error on %s, skipping: %s", url, exc)
            break
        if response.status_code == 404:
            # Some combos (e.g. pronajem/pozemek) legitimately 404 —
            # don't warn, just move on to the next cursor.
            logger.debug("Category %s/%s returned 404, skipping", cursor.category_main, cursor.category_sub)
            break
        if response.status_code != 200:
            logger.warning("Non-200 on %s (%d), skipping", url, response.status_code)
            break

        soup = BeautifulSoup(response.text, "lxml")
        items = soup.find_all(class_="inzeraty")
        if not items:
            logger.debug("No items on %s, stopping pagination", url)
            break

        parsed = [_parse_listing(el, cursor) for el in items]
        collected.extend(p for p in parsed if p is not None)
        logger.debug("Page %s fetched %d items", url, len(items))

    return collected


async def fetch_listings(pages: int) -> list[Listing]:
    cursors = _build_category_matrix()
    listings: list[Listing] = []
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=30, follow_redirects=True
    ) as client:
        for cursor in cursors:
            listings.extend(await _scrape_category(client, cursor, pages))
    return _deduplicate(listings)

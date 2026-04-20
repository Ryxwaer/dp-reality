"""Bazos list-page scraper."""
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


_CATEGORY_MAIN_TO_PRICE: dict[str, PriceType] = {
    "prodam": PriceType.SALE,
    # Rent pages live under /pronajmu/ (verb form), NOT /pronajem/.
    "pronajmu": PriceType.RENT,
}

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

# Czech PSČ anchored at the end: city and PSČ often run together ("Jičín508 01").
_PSC_PATTERN = re.compile(r"(\d{3})\s*(\d{2})\s*$")


@dataclass(frozen=True)
class _CategoryCursor:
    """One (transaction × property) cell of the scrape matrix."""
    category_main: str
    category_sub: str
    price_type: PriceType
    property_type: PropertyType


def _build_category_matrix() -> list[_CategoryCursor]:
    return [
        _CategoryCursor(main, sub, price_type, property_type)
        for main, price_type in _CATEGORY_MAIN_TO_PRICE.items()
        for sub, property_type in _CATEGORY_SUB_TO_PROPERTY.items()
    ]


def _parse_price(raw: str) -> int | None:
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


def _parse_listing_id(href: str) -> str | None:
    match = _INZERAT_ID_RE.match(href)
    return match.group(1) if match else None


def _parse_locality(raw: str) -> tuple[str | None, str | None]:
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
    base = f"{BASE_URL}{cursor.category_main}/{cursor.category_sub}/"
    return base if page == 0 else f"{base}{page * 20}/"


def _deduplicate(listings: Iterable[Listing]) -> list[Listing]:
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

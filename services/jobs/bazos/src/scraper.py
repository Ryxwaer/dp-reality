import re
import logging

import httpx
from bs4 import BeautifulSoup

from models import Listing, PriceType, PropertyType

BASE_URL = "https://reality.bazos.cz/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

logger = logging.getLogger(__name__)


def _parse_price(raw: str) -> tuple[int | None, PriceType]:
    price_type = PriceType.RENT if "měs" in raw else PriceType.SALE
    digits = re.sub(r"[^\d]", "", raw)
    return (int(digits) if digits else None), price_type


def _extract_source_id(href: str) -> str | None:
    parts = [p for p in href.split("/") if p]
    if len(parts) < 2:
        return None
    return parts[1].split("-")[0]


def _extract_disposition(title: str) -> str | None:
    match = re.search(r"\b(\d+\+(?:kk|\d+))\b", title, re.IGNORECASE)
    return match.group(1) if match else None


def _extract_city(locality_raw: str) -> str | None:
    city = re.sub(r"\s*\d{3}\s+\d{2}$", "", locality_raw).strip()
    return city if city else None


def _parse_listing(element, base_url: str) -> Listing | None:
    title_link = element.select_one("h2.nadpis a")
    price_el = element.find(class_="inzeratycena")
    location_el = element.find(class_="inzeratylok")

    if not title_link:
        return None

    href = title_link.get("href", "")
    title = title_link.get_text(strip=True)

    locality_raw: str | None = None
    if location_el:
        locality_raw = location_el.get_text(separator="\n", strip=True).split("\n")[0].strip()

    price_raw = price_el.get_text(strip=True) if price_el else ""

    source_id = _extract_source_id(href)
    if not source_id or not title:
        return None

    price, price_type = _parse_price(price_raw)

    return Listing(
        source_id=source_id,
        title=title,
        price=price,
        price_type=price_type,
        disposition=_extract_disposition(title),
        city=_extract_city(locality_raw) if locality_raw else None,
        locality_raw=locality_raw,
        url=base_url.rstrip("/") + href,
    )


async def fetch_listings(pages: int) -> list[Listing]:
    listings: list[Listing] = []
    seen_ids: set[str] = set()

    async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        for page in range(pages):
            url = BASE_URL if page == 0 else f"{BASE_URL}{page * 20}/"
            try:
                response = await client.get(url)
                response.raise_for_status()

                soup = BeautifulSoup(response.text, "lxml")
                items = soup.find_all(class_="inzeraty")

                if not items:
                    logger.debug("No items on page %d, stopping pagination", page)
                    break

                for el in items:
                    listing = _parse_listing(el, BASE_URL)
                    if listing and listing.source_id not in seen_ids:
                        seen_ids.add(listing.source_id)
                        listings.append(listing)

                logger.debug("Page %d (url=%s): fetched %d items", page, url, len(items))

            except httpx.HTTPError as exc:
                logger.warning("HTTP error on page %d, skipping: %s", page, exc)

    return listings

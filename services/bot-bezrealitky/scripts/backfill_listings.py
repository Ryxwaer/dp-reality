"""One-off backfill of `listings_bezrealitky` using the bot's own scraper.

The live scheduler in `src/cycle.py` calls `scraper.fetch_listings()`,
which walks `settings.scrape_pages` (default 3) pages per
(offer_type, estate_type) tuple — enough to catch new listings each
cycle, but not nearly enough to surface the long tail of currently
active bezrealitky listings.

This script reuses the bot's exact GraphQL primitives —
`scraper._CATEGORY_MATRIX`, `scraper._fetch_category_page`,
`scraper._summary_to_listing`, the same throttle, and
`repository.upsert_listings` — but walks each category to the end
(empty `list` from the GraphQL response is treated as end-of-pagination
just like the live scraper does). It deliberately skips detail
enrichment and matcher/notifier, because:

  * The matcher reads only base fields (estate_type/offer_type/price/
    surface/gps/...). Description, energy class and extra photos
    surfaced by `enrich_with_detail` are not used by matching.
  * Detail-fetching N≈thousands of adverts at the 2s/page throttle
    would take many hours and risks a 429/403 from the WAF.

Run inside the bot-bezrealitky container so motor/httpx/etc are
available:

    docker exec dp-reality-bot-bezrealitky python -m scripts.backfill_listings
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, UTC

import httpx
import motor.motor_asyncio

from src import repository, scraper
from src.config import settings

# Safety ceiling. Bezrealitky is a small portal (low thousands per
# category at most), so 10_000 pages × 30/page is effectively unbounded
# while still bounding the loop.
PAGES_LIMIT = 10_000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("backfill")


async def _backfill_category(
    db,
    client: httpx.AsyncClient,
    *,
    offer_type,
    estate_type,
    run_id: str,
) -> tuple[int, int]:
    tag = f"{offer_type.value}/{estate_type.value}"
    logger.info("[%s] starting backfill", tag)

    scraped = 0
    upserted = 0
    seen: set[str] = set()
    listings = []

    for page in range(PAGES_LIMIT):
        page_items = await scraper._fetch_category_page(
            client, offer_type=offer_type, estate_type=estate_type, page=page
        )
        if not page_items:
            break
        for summary in page_items:
            if summary.advert_id in seen:
                continue
            listing = scraper._summary_to_listing(summary)
            if listing is None:
                continue
            seen.add(summary.advert_id)
            listings.append(listing)
        scraped = len(listings)
        if page % 10 == 0:
            logger.info("[%s] page %d — accumulated %d", tag, page, scraped)
        await asyncio.sleep(settings.scrape_throttle_seconds_between_pages)

    new_listings = await repository.upsert_listings(db, listings, run_id)
    upserted = len(new_listings)
    logger.info("[%s] done — scraped=%d new=%d", tag, scraped, upserted)
    return scraped, upserted


async def _backfill() -> None:
    mongo_uri = os.environ.get("MONGODB_URI") or settings.mongodb_uri
    run_id = (
        f"backfill-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
        f"-{uuid.uuid4().hex[:8]}"
    )
    logger.info("run_id=%s", run_id)

    client = motor.motor_asyncio.AsyncIOMotorClient(mongo_uri)
    db = client.get_default_database()
    before = await db[repository.LISTINGS_COLLECTION].estimated_document_count()
    logger.info("collection size before: %d", before)

    totals = {"scanned": 0, "upserted": 0, "categories": 0}
    async with httpx.AsyncClient(follow_redirects=True) as http_client:
        for offer_type, estate_type in scraper._CATEGORY_MATRIX:
            try:
                scraped, upserted = await _backfill_category(
                    db, http_client,
                    offer_type=offer_type, estate_type=estate_type,
                    run_id=run_id,
                )
            except scraper._BlockedError as exc:
                logger.error(
                    "[%s/%s] BLOCKED by WAF (%s) — aborting backfill",
                    offer_type.value, estate_type.value, exc,
                )
                break
            totals["scanned"] += scraped
            totals["upserted"] += upserted
            totals["categories"] += 1

    after = await db[repository.LISTINGS_COLLECTION].estimated_document_count()
    logger.info(
        "SUMMARY: categories=%d scanned=%d upserted=%d",
        totals["categories"], totals["scanned"], totals["upserted"],
    )
    logger.info("collection size after: %d (delta %d)", after, after - before)
    client.close()


if __name__ == "__main__":
    asyncio.run(_backfill())

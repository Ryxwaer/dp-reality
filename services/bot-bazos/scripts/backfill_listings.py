"""One-off backfill of `listings_bazos` using the bot's own scraper.

The live scheduler in `src/cycle.py` calls `scraper.fetch_listings` with
`SCRAPE_PAGES` (defaults to 5), so each cycle only walks the first
~5*20=100 listings per (price_type, property_type) bucket. That is
enough to catch *new* listings as they appear at the top of every
category page, but it leaves the long tail of currently-active bazos
listings invisible to the matcher.

This script reuses the bot's exact scraping primitives — the
`_build_category_matrix`, `_scrape_category`, and
`repository.upsert_listings` functions — but walks each category to the
end (bazos returns 404 once `page*20` exceeds the row count, which
`_scrape_category` interprets as end-of-pagination). It deliberately
skips the matcher/notifier so the backfilled rows do not spam users.

Run inside the bot-bazos container (so it has motor, httpx, bs4, etc.):

    docker exec -i dp-reality-bot-bazos \
        python -m scripts.backfill_listings

or, after `docker cp`ing the file into /app/scripts/, the same `-m`
invocation works because /app is the bot's WORKDIR.
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

# Safety ceiling. Bazos' largest category tops out around ~4k pages on
# the long tail (page=10000 is 404 across every category we tested), so
# 20000 is "effectively unbounded" while still bounding the loop.
PAGES_LIMIT = 20_000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("backfill")


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

    cursors = scraper._build_category_matrix()
    totals = {"scanned": 0, "upserted": 0, "categories": 0}

    async with httpx.AsyncClient(
        headers=scraper.HEADERS, timeout=30, follow_redirects=True
    ) as http_client:
        for cursor in cursors:
            tag = f"{cursor.category_main}/{cursor.category_sub}"
            logger.info("[%s] starting backfill (pages<=%d)", tag, PAGES_LIMIT)
            category_listings = await scraper._scrape_category(
                http_client, cursor, PAGES_LIMIT
            )

            new_listings = await repository.upsert_listings(
                db, category_listings, run_id
            )

            totals["scanned"] += len(category_listings)
            totals["upserted"] += len(new_listings)
            totals["categories"] += 1
            logger.info(
                "[%s] done — scraped=%d new=%d (cumulative scanned=%d upserted=%d)",
                tag,
                len(category_listings),
                len(new_listings),
                totals["scanned"],
                totals["upserted"],
            )

    after = await db[repository.LISTINGS_COLLECTION].estimated_document_count()
    logger.info(
        "SUMMARY: categories=%d scanned=%d upserted=%d",
        totals["categories"],
        totals["scanned"],
        totals["upserted"],
    )
    logger.info("collection size after: %d (delta %d)", after, after - before)
    client.close()


if __name__ == "__main__":
    asyncio.run(_backfill())

"""Configuration for the Bezrealitky bot service.

Mirrors bot-bazos with two Bezrealitky-specific knobs:
  - `scrape_throttle_seconds_between_pages` — anti-bot enforcement on
    bezrealitky.cz is stronger than on Bazos / Sreality (thesis §4.3.2),
    so the bot sleeps between every list-endpoint fetch.
  - `header_profiles` — a small pool of (User-Agent, Accept-Language)
    pairs rotated round-robin per outgoing HTTP request. Keeps the
    request stream from looking like a single fixed client.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings


_DEFAULT_HEADER_PROFILES: list[dict[str, str]] = [
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.2 Safari/605.1.15"
        ),
        "Accept-Language": "cs,en-US;q=0.9,en;q=0.8",
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) "
            "Gecko/20100101 Firefox/121.0"
        ),
        "Accept-Language": "en-US,en;q=0.7,cs;q=0.3",
    },
]


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    scrape_interval_minutes: int = 10
    # Number of pages to walk per (offer_type, estate_type) tuple per
    # cycle. The list endpoint returns 30 items per page; 3 pages × 6
    # category combinations × 30 items = 540 listings inspected per
    # cycle, which comfortably fits inside the throttle budget below.
    scrape_pages: int = 3
    scrape_page_size: int = 30

    # Anti-bot countermeasures (NFR-01-B). The thesis grants this bot
    # the right to opt into stronger measures than the other two; see
    # `scraper.py` for how these are applied.
    scrape_throttle_seconds_between_pages: float = 2.0
    # On observed 429 / 403 the cycle is aborted and the next cycle is
    # delayed by this many minutes (with a fresh header profile).
    backoff_minutes_on_block: int = 30
    # Maximum number of detail-page fetches per cycle. Detail fetches
    # only happen for newly inserted listings (post-upsert), so this
    # caps the burst — when more new listings appear than the cap, the
    # extras stay summary-only and get their detail enrichment on the
    # next cycle.
    max_detail_fetches_per_cycle: int = 60

    # Self-registration in module_registry. `service_id` becomes the
    # `bot_id` field of the registry row and is also the path slug the
    # BFF reverse-proxies (/modules/<service_id>/*). It MUST match the
    # compose service name / k8s Service name so that `base_url` below
    # resolves to the same pod from any peer in the cluster.
    service_id: str = "bot-bezrealitky"
    display_name: str = "Bezrealitky"
    description: str = (
        "P2P Czech real-estate portal. Direct owner-buyer/tenant. "
        "Hybrid JSON+HTML scraper."
    )
    category: str = "real-estate"
    base_url: str = "http://bot-bezrealitky:8000"
    configure_url: str = "/configure"
    config_collection: str = "bezrealitky_config"

    http_host: str = "0.0.0.0"
    http_port: int = 8000

    header_profiles: list[dict[str, str]] = _DEFAULT_HEADER_PROFILES

    model_config = {"env_file": ".env"}


settings = Settings()

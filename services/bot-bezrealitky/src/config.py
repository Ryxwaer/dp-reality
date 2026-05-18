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
    scrape_pages: int = 3
    scrape_page_size: int = 30

    scrape_throttle_seconds_between_pages: float = 2.0
    backoff_minutes_on_block: int = 30
    max_detail_fetches_per_cycle: int = 60

    geo_seed_mode: str = "missing"
    geo_user_agent: str = "dp-reality-bot-bezrealitky/1.0 (https://github.com/ryxwaer/dp-reality)"

    service_id: str = "bot-bezrealitky"
    display_name: str = "Bezrealitky"
    description: str = (
        "P2P Czech real-estate portal. Direct owner-buyer/tenant. "
        "GraphQL scraper."
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

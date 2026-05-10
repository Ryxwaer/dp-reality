from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    scrape_interval_minutes: int = 5
    scrape_pages: int = 5

    # Self-registration in module_registry. `service_id` becomes the
    # `bot_id` field of the registry row and is also the path slug the
    # BFF reverse-proxies (/modules/<service_id>/*). It MUST match the
    # compose service name / k8s Service name so that `base_url` below
    # resolves to the same pod from any peer in the cluster.
    service_id: str = "bot-bazos"
    display_name: str = "Bazos.cz"
    description: str = (
        "Czech general-purpose classifieds (real estate section). "
        "HTML scraper; updates every few minutes."
    )
    # Marketplace grouping. Free-form slug; the BFF /store page groups
    # modules by this value and falls back to `other` for legacy rows.
    category: str = "real-estate"
    base_url: str = "http://bot-bazos:8000"
    # Path (relative to base_url) of the iframe configuration page. The
    # BFF reads this from the registry and embeds the page directly,
    # so the bot owns its own URL without the BFF having to hardcode
    # `/configure`.
    configure_url: str = "/configure"
    # Name of the Mongo collection where this bot persists its
    # per-configuration documents. Published in module_registry so the
    # BFF can directly mutate `active` / delete rows without going
    # through an HTTP or AMQP indirection.
    config_collection: str = "bazos_config"

    http_host: str = "0.0.0.0"
    http_port: int = 8000

    model_config = {"env_file": ".env"}


settings = Settings()

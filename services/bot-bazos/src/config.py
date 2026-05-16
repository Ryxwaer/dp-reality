from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    geo_service_url: str = "http://geo-cz:8000"
    scrape_interval_minutes: int = 5
    scrape_pages: int = 5

    # `service_id` doubles as the compose / k8s Service name and the
    # `bot_id` field of the registry row, so the URL slug under
    # /modules/<service_id>/* on the BFF resolves to this pod.
    service_id: str = "bot-bazos"
    display_name: str = "Bazos.cz"
    description: str = (
        "Czech general-purpose classifieds (real estate section). "
        "HTML scraper; updates every few minutes."
    )
    category: str = "real-estate"
    base_url: str = "http://bot-bazos:8000"
    configure_url: str = "/configure"
    config_collection: str = "bazos_config"

    http_host: str = "0.0.0.0"
    http_port: int = 8000

    model_config = {"env_file": ".env"}


settings = Settings()

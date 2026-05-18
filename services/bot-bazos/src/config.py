from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    scrape_interval_minutes: int = 5
    scrape_pages: int = 5

    geo_data_path: str = "/data/CZ.txt"
    geo_seed_mode: str = "missing"

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

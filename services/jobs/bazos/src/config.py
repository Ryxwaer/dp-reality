from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    scrape_interval_minutes: int = 5
    scrape_pages: int = 5

    model_config = {"env_file": ".env"}


settings = Settings()

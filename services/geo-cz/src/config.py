from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    service_id: str = "geo-cz"
    http_host: str = "0.0.0.0"
    http_port: int = 8000

    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    # Collection lives alongside every other bot's private collection in
    # the shared `dp-reality` database. Reads are open to any peer that
    # the NetworkPolicy allows; writes only happen during the boot-time
    # seed.
    collection: str = "geo_psc_cz"

    # Geonames CZ.txt (tab-separated, no header) bundled into the image.
    # On boot we upsert the file's contents into Mongo and then never
    # touch it again. Override only for local dev outside Docker.
    geo_data_path: str = "/data/CZ.txt"

    # Re-seed semantics: when "missing", the seeder upserts only if the
    # collection is empty; when "always", it upserts on every boot
    # (idempotent — keyed on (psc, city)). "never" disables the seeder
    # entirely, useful when a sibling job (CronJob) owns refresh.
    seed_mode: str = "missing"

    model_config = {"env_file": ".env"}


settings = Settings()

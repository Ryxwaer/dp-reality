from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongodb_uri: str = "mongodb://localhost:27017/dp-reality"
    grpc_port: int = 50051
    service_name: str = "module-bazos"

    model_config = {"env_file": ".env"}


settings = Settings()

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    API_PREFIX: str = "/api"

    PGPORT: int = 5432
    PGHOST: str = ""
    PGDATABASE: str = ""
    PGUSER: str = ""
    PGPASSWORD: str = ""
    PGSSLMODE: str = "require"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

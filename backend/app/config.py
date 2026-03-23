from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://siu:siu@localhost:5432/siu"

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Google Gemini API
    gemini_api_key: str = ""
    # JWT
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Read-only DB
    database_url_readonly: str = ""

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

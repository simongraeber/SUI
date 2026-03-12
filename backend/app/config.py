from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://siu:siu@localhost:5432/siu"

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Google Gemini API
    gemini_api_key: str = ""
    gemini_image_prompt: str = "Transform this person into a plastic foosball table player figure. Keep the exact same hair color, hair style, skin tone, eye color, and general facial features and general clothing style of the person in the reference photo, but render them as a rigid, molded, hard plastic foosball figure from the chest up. The plastic surface should be thick and glossy with visible paint strokes, small chips, scratches, and wear marks exposing raw lighter plastic underneath. There is no mouth at all, just smooth blank plastic below the nose, exactly like a real foosball figure. The nose is a small, simple, rounded molded plastic bump. The hair should look like a solid molded plastic shape painted to match the original hair color, with visible brush strokes in the paint. The ears are simple small molded bumps on each side of the head. The background is pure solid white. Shot as extreme macro photography, high-contrast studio lighting, portrait. Gritty dive-bar aesthetic. --ar 1:1"

    # JWT
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Read-only DB
    database_url_readonly: str = ""

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

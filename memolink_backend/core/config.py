from pydantic_settings import BaseSettings
from pathlib import Path
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(BACKEND_ROOT / ".env")


class Settings(BaseSettings):
    app_name: str = "MemoLink API"

    database_url: str
    openai_api_key: str
    openai_chat_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    gemini_api_key: str = ""
    deepseek_api_key: str = ""
    deepgram_api_key: str = ""
    brave_search_api_key: str = ""
    semantic_scholar_api_key: str = ""

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    frontend_url: str = "http://localhost:5173"

    encryption_key: str = ""

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/email/callback"

    teams_client_id: str = ""
    teams_client_secret: str = ""
    teams_tenant_id: str = ""
    teams_redirect_uri: str = "http://localhost:8000/api/teams/callback"

    aws_access_key_id: str = ""       # Optional - Lambda uses IAM role automatically
    aws_secret_access_key: str = ""   # Optional - Lambda uses IAM role automatically
    aws_session_token: str = ""       # Required when using STS temporary credentials explicitly
    aws_region: str = "ap-southeast-2"
    s3_upload_bucket: str = ""

    class Config:
        env_file = ".env"


settings = Settings()

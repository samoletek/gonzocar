from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://postgres:postgres@localhost:5432/gonzo"
    
    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours
    
    # Gmail API
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_refresh_token: str = ""
    
    # OpenPhone
    openphone_api_key: str = ""
    openphone_phone_number: str = "+13123002032"
    
    # Stripe
    stripe_api_key: str = ""

    # Internal cron trigger (Railway function -> backend)
    internal_cron_token: str = ""
    
    class Config:
        env_file = ".env.local"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()

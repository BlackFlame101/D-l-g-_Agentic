"""
Application configuration using Pydantic Settings.
Loads from environment variables and .env file.
"""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    app_name: str = "Delege API"
    debug: bool = False
    log_level: str = "INFO"

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Celery
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"

    # Google Gemini
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_embedding_model: str = "text-embedding-004"
    gemini_embedding_dimensions: int = 768

    # WhatsApp Bridge
    whatsapp_bridge_url: str = "http://localhost:3001"
    whatsapp_bridge_api_secret: str = "dev-secret-change-in-production"

    # CORS
    cors_origins: List[str] = ["http://localhost:3000"]

    # RAG / conversation tuning
    rag_top_k: int = 5
    rag_match_threshold: float = 0.65
    conversation_history_limit: int = 10

    # Document processing
    knowledge_chunk_size: int = 800
    knowledge_chunk_overlap: int = 120
    knowledge_embed_batch_size: int = 16

    # Storage
    knowledge_bucket: str = "knowledge-files"

    @property
    def is_configured(self) -> bool:
        """Check if essential settings are configured."""
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

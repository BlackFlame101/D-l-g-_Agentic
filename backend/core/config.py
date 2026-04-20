"""
Application configuration using Pydantic Settings.
Loads from environment variables and .env file.
"""

import json
from functools import lru_cache
from typing import Any, List
from urllib.parse import urlparse

from pydantic import field_validator
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
    # text-embedding-004 is no longer exposed through the v1beta `embedContent`
    # endpoint on current API keys (returns 404 NOT_FOUND). Use the unified
    # `gemini-embedding-001` model and explicitly request 768-dim output so it
    # fits the `vector(768)` column in `knowledge_chunks`.
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_embedding_dimensions: int = 768

    # WhatsApp Bridge
    whatsapp_bridge_url: str = "http://localhost:3001"
    whatsapp_bridge_api_secret: str = "dev-secret-change-in-production"

    # CORS
    cors_origins: List[str] = ["http://localhost:3000"]

    # RAG / conversation tuning
    rag_top_k: int = 5
    rag_match_threshold: float = 0.30
    conversation_history_limit: int = 10

    # Document processing
    knowledge_chunk_size: int = 800
    knowledge_chunk_overlap: int = 120
    knowledge_embed_batch_size: int = 16

    # Storage
    knowledge_bucket: str = "knowledge-files"

    # Test harness knobs (never set in production). Read at call time so
    # tests can flip them via environment variables per-test.
    test_llm_mode: str = ""  # "", "stub", "stub_fallback", "stub_error"
    test_embed_mode: str = ""  # "", "stub"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> Any:
        """Accept either a JSON list or a comma-separated string for CORS_ORIGINS.

        Pydantic v2's default for ``List[str]`` only parses JSON. Users often
        paste ``CORS_ORIGINS=https://a.com,https://b.com`` (CSV) or
        ``CORS_ORIGINS=https://a.com`` (single value) into Railway/Vercel and
        the app refuses to boot with an opaque ValidationError. Normalize both.
        """
        if value is None or isinstance(value, list):
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @field_validator("whatsapp_bridge_url", mode="before")
    @classmethod
    def _normalize_whatsapp_bridge_url(cls, value: Any) -> str:
        """Normalize Railway/Fly style URL env vars into a valid base URL."""
        if value is None:
            return "http://localhost:3001"

        raw = str(value).strip()
        if not raw:
            return "http://localhost:3001"

        # Railway/Fly UI copy-paste sometimes includes wrapping quotes.
        cleaned = raw.strip("'\"").rstrip("/")

        # If host is provided without scheme, default to HTTPS for public bridge.
        if "://" not in cleaned:
            cleaned = f"https://{cleaned}"

        parsed = urlparse(cleaned)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                "WHATSAPP_BRIDGE_URL must be a valid absolute http(s) URL, "
                f'got "{value}"'
            )

        return cleaned

    @property
    def is_configured(self) -> bool:
        """Check if essential settings are configured."""
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()

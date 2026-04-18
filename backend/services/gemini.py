"""Gemini helpers for embeddings and generation-side utilities.

Uses the unified ``google.genai`` SDK (same one Agno depends on). The older
``google.generativeai`` package is deprecated and not used here.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable, List

from google import genai
from google.genai import types

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    """Return a cached Gemini client configured with the project API key."""
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured.")
    return genai.Client(api_key=settings.google_api_key)


def _embed_model_name() -> str:
    name = settings.gemini_embedding_model
    return name if name.startswith("models/") else f"models/{name}"


def embed_text(text: str, task_type: str = "RETRIEVAL_QUERY") -> List[float]:
    """Embed a single string with Gemini's text-embedding model.

    ``task_type`` is the hint Gemini uses to adapt the embedding; valid values
    include ``RETRIEVAL_QUERY`` (default here - used for incoming user
    questions) and ``RETRIEVAL_DOCUMENT`` (used when indexing knowledge-base
    chunks).
    """
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text.")

    resp = _client().models.embed_content(
        model=_embed_model_name(),
        contents=text,
        config=types.EmbedContentConfig(task_type=task_type),
    )
    if not resp.embeddings:
        raise RuntimeError("Gemini returned no embeddings.")
    return list(resp.embeddings[0].values or [])


def embed_documents(texts: Iterable[str]) -> List[List[float]]:
    """Embed multiple documents (``RETRIEVAL_DOCUMENT`` task type)."""
    items = [t for t in texts if t and t.strip()]
    if not items:
        return []

    try:
        resp = _client().models.embed_content(
            model=_embed_model_name(),
            contents=items,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        )
        if resp.embeddings and len(resp.embeddings) == len(items):
            return [list(e.values or []) for e in resp.embeddings]
    except Exception as exc:  # pragma: no cover - SDK / quota transient
        logger.debug("Batch embed failed, falling back to sequential", extra={"error": str(exc)})

    return [embed_text(t, task_type="RETRIEVAL_DOCUMENT") for t in items]


def approximate_token_count(text: str) -> int:
    """Rough token estimate used for usage accounting.

    A 1 token ~= 4 characters heuristic is close enough for billing/quota
    purposes and avoids adding tiktoken (which may not have 3.14 wheels).
    """
    if not text:
        return 0
    return max(1, len(text) // 4)

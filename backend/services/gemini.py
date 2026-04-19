"""Gemini helpers for embeddings and generation-side utilities.

Uses the unified ``google.genai`` SDK (same one Agno depends on). The older
``google.generativeai`` package is deprecated and not used here.
"""

from __future__ import annotations

import hashlib
import math
import os
from functools import lru_cache
from typing import Iterable, List

from google import genai
from google.genai import types

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


def _test_embed_mode() -> str:
    """Read TEST_EMBED_MODE at call time so tests can flip it per-test."""
    return (os.environ.get("TEST_EMBED_MODE") or settings.test_embed_mode or "").strip().lower()


def _stub_embedding(text: str) -> List[float]:
    """Deterministic 768-d unit vector derived from ``text``.

    Used by the E2E harness to exercise the RAG pipeline without calling
    Gemini. Same input -> same vector; different inputs are very likely to
    map to different vectors thanks to SHA-512 expansion.
    """
    dims = settings.gemini_embedding_dimensions or 768
    # Expand SHA-512 (64 bytes) into the target dimensionality by hashing
    # indexed variants. This keeps the function pure and deterministic.
    raw = bytearray()
    counter = 0
    while len(raw) < dims * 2:
        digest = hashlib.sha512(f"{counter}:{text}".encode("utf-8")).digest()
        raw.extend(digest)
        counter += 1
    # Build a float vector in [-1, 1]
    vec = [((raw[i] / 255.0) * 2.0 - 1.0) for i in range(dims)]
    # Normalize to unit length (matches Gemini's normalized embeddings)
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    """Return a cached Gemini client configured with the project API key."""
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured.")
    return genai.Client(api_key=settings.google_api_key)


def _embed_model_name() -> str:
    name = settings.gemini_embedding_model
    return name if name.startswith("models/") else f"models/{name}"


def _embed_config(task_type: str) -> "types.EmbedContentConfig":
    """Build an ``EmbedContentConfig`` with task type + output dimensionality.

    ``gemini-embedding-001`` returns 3072-d vectors by default. Our pgvector
    column is ``vector(768)``, so we must request 768-d Matryoshka truncation
    here — otherwise inserts fail with a dimension-mismatch error from
    Postgres. ``settings.gemini_embedding_dimensions`` stays authoritative.
    """
    return types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=settings.gemini_embedding_dimensions,
    )


def embed_text(text: str, task_type: str = "RETRIEVAL_QUERY") -> List[float]:
    """Embed a single string with Gemini's text-embedding model.

    ``task_type`` is the hint Gemini uses to adapt the embedding; valid values
    include ``RETRIEVAL_QUERY`` (default here - used for incoming user
    questions) and ``RETRIEVAL_DOCUMENT`` (used when indexing knowledge-base
    chunks).
    """
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text.")

    if _test_embed_mode() == "stub":
        return _stub_embedding(text)

    resp = _client().models.embed_content(
        model=_embed_model_name(),
        contents=text,
        config=_embed_config(task_type),
    )
    if not resp.embeddings:
        raise RuntimeError("Gemini returned no embeddings.")
    return list(resp.embeddings[0].values or [])


def embed_documents(texts: Iterable[str]) -> List[List[float]]:
    """Embed multiple documents (``RETRIEVAL_DOCUMENT`` task type)."""
    items = [t for t in texts if t and t.strip()]
    if not items:
        return []

    if _test_embed_mode() == "stub":
        return [_stub_embedding(t) for t in items]

    try:
        resp = _client().models.embed_content(
            model=_embed_model_name(),
            contents=items,
            config=_embed_config("RETRIEVAL_DOCUMENT"),
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

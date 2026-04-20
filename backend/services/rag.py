"""Knowledge-base retrieval helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

from core.config import settings
from core.logging import get_logger
from services.gemini import embed_text
from services.supabase import get_admin_client

logger = get_logger(__name__)


@dataclass(frozen=True)
class RetrievedChunk:
    """A knowledge-base chunk returned from the vector search."""

    id: str
    content: str
    similarity: float
    metadata: dict

    def to_log_dict(self) -> dict:
        return {"id": self.id, "similarity": round(self.similarity, 4)}


def retrieve_context(
    agent_id: str,
    query: str,
    top_k: int | None = None,
    threshold: float | None = None,
) -> List[RetrievedChunk]:
    """Embed ``query`` and look up the top-k most similar chunks.

    Returns an empty list when the query is blank, the agent has no indexed
    knowledge, or the embedding call fails. Logs errors but never raises so
    the agent can still respond (maybe without RAG).
    """
    if not query or not query.strip():
        return []

    k = top_k or settings.rag_top_k
    th = threshold if threshold is not None else settings.rag_match_threshold

    try:
        embedding = embed_text(query, task_type="retrieval_query")
    except Exception as exc:
        logger.warning("Embedding failed; skipping RAG", extra={"error": str(exc)})
        return []

    try:
        admin = get_admin_client()
        resp = admin.rpc(
            "search_knowledge_chunks",
            {
                "query_embedding": embedding,
                "p_agent_id": agent_id,
                "match_threshold": th,
                "match_count": k,
            },
        ).execute()
    except Exception as exc:
        logger.warning("RAG search RPC failed", extra={"error": str(exc), "agent_id": agent_id})
        return []

    rows = resp.data or []
    chunks = [
        RetrievedChunk(
            id=str(row["id"]),
            content=row.get("content") or "",
            similarity=float(row.get("similarity") or 0.0),
            metadata=row.get("metadata") or {},
        )
        for row in rows
    ]

    # If vector search returns nothing (often due to language mismatch / typo),
    # fall back to a lightweight lexical search so the assistant can still use KB.
    if not chunks:
        chunks = _lexical_fallback_context(agent_id=agent_id, query=query, k=k)
        if chunks:
            logger.info(
                "RAG lexical fallback matched chunks",
                extra={"agent_id": agent_id, "chunk_count": len(chunks)},
            )

    logger.info(
        "RAG retrieved chunks",
        extra={
            "agent_id": agent_id,
            "chunk_count": len(chunks),
            "top_similarity": chunks[0].similarity if chunks else None,
        },
    )
    return chunks


def _lexical_fallback_context(agent_id: str, query: str, k: int) -> List[RetrievedChunk]:
    tokens = _query_tokens(query)
    if not tokens:
        return []

    # Try the most meaningful tokens first.
    top_tokens = tokens[:4]
    admin = get_admin_client()

    kb_resp = (
        admin.table("knowledge_bases")
        .select("id")
        .eq("agent_id", agent_id)
        .eq("status", "ready")
        .is_("deleted_at", "null")
        .limit(50)
        .execute()
    )
    kb_rows = kb_resp.data or []
    kb_ids = [str(row["id"]) for row in kb_rows if row.get("id")]
    if not kb_ids:
        return []

    # Query with multiple token attempts and dedupe by chunk id.
    dedup: dict[str, RetrievedChunk] = {}
    for token in top_tokens:
        resp = (
            admin.table("knowledge_chunks")
            .select("id,content,metadata,knowledge_base_id")
            .in_("knowledge_base_id", kb_ids)
            .ilike("content", f"%{token}%")
            .limit(max(k * 2, 10))
            .execute()
        )
        for row in (resp.data or []):
            cid = str(row.get("id") or "")
            if not cid or cid in dedup:
                continue
            dedup[cid] = RetrievedChunk(
                id=cid,
                content=row.get("content") or "",
                # Synthetic similarity score for lexical fallback.
                similarity=0.51,
                metadata=row.get("metadata") or {},
            )
            if len(dedup) >= k:
                return list(dedup.values())[:k]

    return list(dedup.values())[:k]


def _query_tokens(query: str) -> List[str]:
    words = re.findall(r"[a-zA-Z0-9À-ÿ]{3,}", (query or "").lower())
    stop = {
        "the",
        "and",
        "for",
        "with",
        "what",
        "who",
        "you",
        "your",
        "les",
        "des",
        "est",
        "une",
        "dans",
        "chno",
        "chni",
        "dyal",
        "dial",
        "badr",
    }
    uniq: List[str] = []
    for w in words:
        if w in stop:
            continue
        if w not in uniq:
            uniq.append(w)
    return uniq


def format_chunks_for_prompt(chunks: List[RetrievedChunk]) -> str:
    """Render retrieved chunks as a system-prompt context block."""
    if not chunks:
        return ""
    lines = ["Knowledge base excerpts (use when relevant, ignore otherwise):"]
    for i, chunk in enumerate(chunks, start=1):
        lines.append(f"[{i}] (similarity={chunk.similarity:.2f})\n{chunk.content.strip()}")
    return "\n\n".join(lines)

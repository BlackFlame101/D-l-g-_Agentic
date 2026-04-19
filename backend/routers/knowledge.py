"""Knowledge-base routes.

The frontend uploads files directly to Supabase Storage (bucket
``knowledge-files``) under the user's own folder, then calls this endpoint
with the storage path so the backend only owns indexing, not the upload bytes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from core.config import settings
from core.logging import get_logger
from core.security import CurrentUser, get_current_user
from schemas.knowledge import KnowledgeBaseOut, KnowledgeIndexRequest
from services.documents import SUPPORTED_FILE_TYPES
from services.supabase import get_admin_client

logger = get_logger(__name__)

router = APIRouter(prefix="/api/agents/{agent_id}/knowledge", tags=["knowledge"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assert_agent_ownership(agent_id: UUID, user_id: str) -> dict:
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("id, user_id")
        .eq("id", str(agent_id))
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    return resp.data[0]


@router.get("", response_model=List[KnowledgeBaseOut])
async def list_knowledge(
    agent_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> List[KnowledgeBaseOut]:
    _assert_agent_ownership(agent_id, user.id)
    admin = get_admin_client()
    resp = (
        admin.table("knowledge_bases")
        .select("*")
        .eq("agent_id", str(agent_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return [KnowledgeBaseOut.model_validate(row) for row in (resp.data or [])]


@router.post("", response_model=KnowledgeBaseOut, status_code=status.HTTP_202_ACCEPTED)
async def create_knowledge_entry(
    agent_id: UUID,
    payload: KnowledgeIndexRequest,
    user: CurrentUser = Depends(get_current_user),
) -> KnowledgeBaseOut:
    """Register a previously uploaded file and enqueue indexing."""
    _assert_agent_ownership(agent_id, user.id)

    file_type = payload.file_type.lower().lstrip(".")
    if file_type not in SUPPORTED_FILE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type. Allowed: {sorted(SUPPORTED_FILE_TYPES)}",
        )

    expected_prefix = f"{user.id}/{agent_id}/"
    if not payload.storage_path.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="storage_path must live under {user_id}/{agent_id}/ (RLS convention).",
        )

    admin = get_admin_client()
    row = {
        "agent_id": str(agent_id),
        "file_name": payload.file_name,
        "file_url": payload.storage_path,
        "file_type": file_type,
        "file_size_bytes": payload.file_size_bytes,
        "status": "pending",
        "chunk_count": 0,
    }
    resp = admin.table("knowledge_bases").insert(row).execute()
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create knowledge base row.",
        )
    kb = resp.data[0]

    from services.tasks import index_knowledge_file

    index_knowledge_file.delay(str(kb["id"]))

    logger.info(
        "Queued knowledge indexing",
        extra={"kb_id": kb["id"], "agent_id": str(agent_id), "user_id": user.id},
    )
    _ = settings  # keep settings referenced for potential per-plan size limits later
    return KnowledgeBaseOut.model_validate(kb)


@router.delete("/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_entry(
    agent_id: UUID,
    kb_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Soft-delete a KB row and drop its embedded chunks.

    The file in Supabase Storage is left alone; the user can reuse it later.
    """
    _assert_agent_ownership(agent_id, user.id)
    admin = get_admin_client()

    row = (
        admin.table("knowledge_bases")
        .select("id, agent_id")
        .eq("id", str(kb_id))
        .eq("agent_id", str(agent_id))
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge base entry not found.",
        )

    admin.table("knowledge_chunks").delete().eq("knowledge_base_id", str(kb_id)).execute()
    admin.table("knowledge_bases").update(
        {"deleted_at": _now_iso(), "chunk_count": 0}
    ).eq("id", str(kb_id)).execute()

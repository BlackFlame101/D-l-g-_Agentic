"""Read-only conversation and message endpoints for the dashboard."""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.logging import get_logger
from core.security import CurrentUser, get_current_user
from schemas.conversation import ConversationOut, ConversationPauseUpdate, MessageOut
from services.supabase import get_admin_client

logger = get_logger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _user_owns_agent(agent_id: str, user_id: str) -> bool:
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("id")
        .eq("id", agent_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    return bool(resp.data)


@router.get("", response_model=List[ConversationOut])
async def list_conversations(
    user: CurrentUser = Depends(get_current_user),
    agent_id: Optional[UUID] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> List[ConversationOut]:
    """List conversations belonging to the caller's agents."""
    admin = get_admin_client()
    agents_resp = (
        admin.table("agents")
        .select("id")
        .eq("user_id", user.id)
        .is_("deleted_at", "null")
        .execute()
    )
    agent_ids = [row["id"] for row in (agents_resp.data or [])]
    if not agent_ids:
        return []

    if agent_id is not None and str(agent_id) not in agent_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")

    query = (
        admin.table("conversations")
        .select("*")
        .is_("deleted_at", "null")
        .order("last_message_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if agent_id is not None:
        query = query.eq("agent_id", str(agent_id))
    else:
        query = query.in_("agent_id", agent_ids)

    resp = query.execute()
    return [ConversationOut.model_validate(row) for row in (resp.data or [])]


@router.get("/{conv_id}/messages", response_model=List[MessageOut])
async def get_conversation_messages(
    conv_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(default=100, ge=1, le=500),
    before: Optional[str] = Query(default=None, description="ISO timestamp for pagination."),
) -> List[MessageOut]:
    """Return message history for a conversation owned by the caller."""
    admin = get_admin_client()
    conv = (
        admin.table("conversations")
        .select("id, agent_id, deleted_at")
        .eq("id", str(conv_id))
        .limit(1)
        .execute()
    )
    if not conv.data or conv.data[0].get("deleted_at") is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if not _user_owns_agent(conv.data[0]["agent_id"], user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")

    query = (
        admin.table("messages")
        .select("*")
        .eq("conversation_id", str(conv_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if before:
        query = query.lt("created_at", before)
    resp = query.execute()
    rows = list(reversed(resp.data or []))
    return [MessageOut.model_validate(r) for r in rows]


@router.patch("/{conv_id}", response_model=ConversationOut)
async def update_conversation_pause(
    conv_id: UUID,
    body: ConversationPauseUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> ConversationOut:
    """Pause/resume one conversation for manual human handoff."""
    admin = get_admin_client()
    conv = (
        admin.table("conversations")
        .select("*")
        .eq("id", str(conv_id))
        .limit(1)
        .execute()
    )
    if not conv.data or conv.data[0].get("deleted_at") is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if not _user_owns_agent(conv.data[0]["agent_id"], user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")

    next_status = "paused" if body.is_paused else "active"
    updated = (
        admin.table("conversations")
        .update({"is_paused": body.is_paused, "status": next_status})
        .eq("id", str(conv_id))
        .execute()
    )
    if not updated.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Update failed.")
    return ConversationOut.model_validate(updated.data[0])

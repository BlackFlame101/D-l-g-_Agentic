"""Dashboard CRUD endpoints for the ``agents`` table."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from core.logging import get_logger
from core.security import CurrentUser, get_current_user
from schemas.agent import AgentCreate, AgentOut, AgentUpdate
from services.supabase import get_admin_client

logger = get_logger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_user_agent(agent_id: UUID, user_id: str) -> dict:
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("id", str(agent_id))
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    return resp.data[0]


@router.get("", response_model=List[AgentOut])
async def list_agents(user: CurrentUser = Depends(get_current_user)) -> List[AgentOut]:
    """Return every non-deleted agent owned by the caller."""
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("user_id", user.id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return [AgentOut.model_validate(row) for row in (resp.data or [])]


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    return AgentOut.model_validate(_fetch_user_agent(agent_id, user.id))


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
async def create_agent(
    payload: AgentCreate,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    """Create an agent for the authenticated user."""
    admin = get_admin_client()
    data = payload.model_dump(exclude_none=True)
    data["user_id"] = user.id
    resp = admin.table("agents").insert(data).execute()
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create agent.",
        )
    return AgentOut.model_validate(resp.data[0])


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: UUID,
    payload: AgentUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    _fetch_user_agent(agent_id, user.id)
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update.",
        )
    updates["updated_at"] = _now_iso()
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .update(updates)
        .eq("id", str(agent_id))
        .eq("user_id", user.id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent.",
        )
    return AgentOut.model_validate(resp.data[0])


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Soft-delete an agent by stamping ``deleted_at``."""
    _fetch_user_agent(agent_id, user.id)
    admin = get_admin_client()
    admin.table("agents").update(
        {"deleted_at": _now_iso(), "is_active": False}
    ).eq("id", str(agent_id)).eq("user_id", user.id).execute()

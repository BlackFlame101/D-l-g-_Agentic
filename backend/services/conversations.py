"""Conversation and message persistence helpers (service-role).

All functions here use the admin Supabase client so they can run from Celery
workers and from the webhook path where we don't have a user JWT.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from core.config import settings
from core.logging import get_logger
from services.agent_factory import HistoryMessage
from services.supabase import get_admin_client

logger = get_logger(__name__)


def get_active_agent_for_user(user_id: str) -> Optional[dict]:
    """Return the user's most recently updated active agent, or None."""
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def reactivate_latest_agent_for_user(user_id: str) -> Optional[dict]:
    """Best-effort recovery when a user has no active agent due to state drift.

    Returns the most recent non-deleted agent, reactivating it first when needed.
    """
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    row = resp.data[0]
    if row.get("is_active"):
        return row

    updated = (
        admin.table("agents")
        .update({"is_active": True, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", row["id"])
        .execute()
    )
    if not updated.data:
        return None
    logger.warning(
        "Reactivated agent after active-state drift",
        extra={"user_id": user_id, "agent_id": row["id"]},
    )
    return updated.data[0]


def get_or_create_conversation(
    agent_id: str,
    contact_phone: str,
    contact_name: Optional[str] = None,
) -> tuple[dict, bool]:
    """Look up a conversation for ``(agent_id, contact_phone)`` or create one.

    Returns ``(conversation_row, is_new)``. ``is_new`` drives the greeting
    flow in :func:`services.tasks.process_whatsapp_message`.
    """
    admin = get_admin_client()
    existing = (
        admin.table("conversations")
        .select("*")
        .eq("agent_id", agent_id)
        .eq("contact_phone", contact_phone)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        if contact_name and row.get("contact_name") != contact_name:
            admin.table("conversations").update({"contact_name": contact_name}).eq(
                "id", row["id"]
            ).execute()
            row["contact_name"] = contact_name
        return row, False

    inserted = (
        admin.table("conversations")
        .insert(
            {
                "agent_id": agent_id,
                "contact_phone": contact_phone,
                "contact_name": contact_name,
                "status": "active",
                "message_count": 0,
            }
        )
        .execute()
    )
    if not inserted.data:
        raise RuntimeError("Failed to create conversation row.")
    return inserted.data[0], True


def insert_message(
    conversation_id: str,
    role: str,
    content: str,
    tokens_used: int = 0,
    metadata: Optional[dict] = None,
) -> dict:
    """Insert a message row; trigger updates conversation stats automatically."""
    admin = get_admin_client()
    row = {
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "tokens_used": tokens_used,
        "metadata": metadata or {},
    }
    resp = admin.table("messages").insert(row).execute()
    if not resp.data:
        raise RuntimeError("Failed to insert message row.")
    return resp.data[0]


def has_message_with_whatsapp_id(whatsapp_message_id: Optional[str]) -> bool:
    """Return True if a message with this WhatsApp message id already exists."""
    msg_id = (whatsapp_message_id or "").strip()
    if not msg_id:
        return False
    admin = get_admin_client()
    resp = (
        admin.table("messages")
        .select("id")
        .contains("metadata", {"whatsapp_message_id": msg_id})
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def pause_conversation_for_human_takeover(
    agent_id: str,
    contact_phone: str,
    contact_name: Optional[str] = None,
) -> None:
    """Mark a conversation paused when the business owner takes over manually."""
    admin = get_admin_client()
    conversation, _ = get_or_create_conversation(
        agent_id=agent_id,
        contact_phone=contact_phone,
        contact_name=contact_name,
    )
    admin.table("conversations").update(
        {
            "is_paused": True,
            "status": "paused",
            "last_message_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", conversation["id"]).execute()


def is_conversation_paused(conversation_id: str) -> bool:
    """Read pause state for a conversation (safe when column is absent)."""
    admin = get_admin_client()
    try:
        resp = (
            admin.table("conversations")
            .select("is_paused")
            .eq("id", conversation_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return False
    if not resp.data:
        return False
    return bool(resp.data[0].get("is_paused"))


def get_user_profile(user_id: str) -> Optional[dict]:
    """Return basic user profile needed for owner notifications."""
    admin = get_admin_client()
    resp = (
        admin.table("users")
        .select("id, full_name, company_name, phone")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def get_conversation_by_id(conversation_id: str) -> Optional[dict]:
    """Return one conversation row by id."""
    admin = get_admin_client()
    resp = (
        admin.table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def mark_owner_alerted(conversation_id: str) -> None:
    """Mark a conversation as already owner-alerted (best effort)."""
    admin = get_admin_client()
    try:
        admin.table("conversations").update({"owner_alerted": True}).eq(
            "id", conversation_id
        ).execute()
    except Exception:
        # Column may not exist yet in some environments.
        return


def load_history(
    conversation_id: str,
    limit: Optional[int] = None,
) -> List[HistoryMessage]:
    """Return the most recent ``limit`` messages in chronological order."""
    n = limit or settings.conversation_history_limit
    admin = get_admin_client()
    resp = (
        admin.table("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(n)
        .execute()
    )
    rows = list(reversed(resp.data or []))
    history: List[HistoryMessage] = []
    for row in rows:
        role = row.get("role") or "user"
        content = row.get("content") or ""
        if not content:
            continue
        history.append(HistoryMessage(role=role, content=content))
    return history


def touch_session(user_id: str) -> None:
    """Best-effort bump of ``whatsapp_sessions.last_active_at`` for observability."""
    try:
        admin = get_admin_client()
        admin.table("whatsapp_sessions").update(
            {"last_active_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", user_id).execute()
    except Exception as exc:  # pragma: no cover - non-fatal
        logger.debug("Failed to touch session", extra={"error": str(exc)})

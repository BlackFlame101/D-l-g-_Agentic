"""Subscription limit and usage tracking."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from core.logging import get_logger
from services.supabase import get_admin_client

logger = get_logger(__name__)


@dataclass(frozen=True)
class LimitCheck:
    """Result of :func:`check_subscription_limit`."""

    allowed: bool
    reason: Optional[str]  # "no_subscription" | "inactive" | "expired" | "limit_reached"
    subscription: Optional[dict]


def _fetch_active_subscription(user_id: str) -> Optional[dict]:
    admin = get_admin_client()
    resp = (
        admin.table("subscriptions")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def check_subscription_limit(user_id: str) -> LimitCheck:
    """Decide whether ``user_id`` can send another message right now."""
    sub = _fetch_active_subscription(user_id)
    if sub is None:
        return LimitCheck(False, "no_subscription", None)

    if sub.get("status") != "active":
        return LimitCheck(False, "inactive", sub)

    expires_at = sub.get("expires_at")
    if expires_at:
        try:
            exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if exp <= datetime.now(timezone.utc):
                return LimitCheck(False, "expired", sub)
        except ValueError:
            logger.warning("Could not parse subscription expires_at", extra={"value": expires_at})

    limit = int(sub.get("message_limit") or 0)
    used = int(sub.get("current_usage") or 0)
    if limit > 0 and used >= limit:
        return LimitCheck(False, "limit_reached", sub)

    return LimitCheck(True, None, sub)


def increment_usage(user_id: str, messages: int = 1, tokens: int = 0) -> None:
    """Record usage: call the ``increment_usage`` RPC and bump the subscription counter."""
    admin = get_admin_client()

    try:
        admin.rpc(
            "increment_usage",
            {"p_user_id": user_id, "p_messages": messages, "p_tokens": tokens},
        ).execute()
    except Exception as exc:
        logger.warning("increment_usage RPC failed", extra={"error": str(exc), "user_id": user_id})

    sub = _fetch_active_subscription(user_id)
    if not sub:
        return
    try:
        new_usage = int(sub.get("current_usage") or 0) + messages
        admin.table("subscriptions").update({"current_usage": new_usage}).eq(
            "id", sub["id"]
        ).execute()
    except Exception as exc:
        logger.warning(
            "Failed to update subscription.current_usage",
            extra={"error": str(exc), "user_id": user_id},
        )

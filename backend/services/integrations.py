"""Persistence helpers for external integrations (Shopify first)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core.logging import get_logger
from services.crypto import decrypt, encrypt
from services.supabase import get_admin_client

logger = get_logger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_store_url(store_url: str) -> str:
    value = (store_url or "").strip().lower()
    value = value.replace("https://", "").replace("http://", "")
    value = value.strip("/")
    if "/" in value:
        value = value.split("/", 1)[0]
    return value


def save_shopify_integration(
    user_id: str,
    store_url: str,
    access_token: str,
) -> dict:
    """Upsert a Shopify integration and store encrypted credentials."""
    normalized_store = _normalize_store_url(store_url)
    token = (access_token or "").strip()
    if not normalized_store or not token:
        raise ValueError("store_url and access_token are required.")

    admin = get_admin_client()
    config = {
        "store_url": normalized_store,
        "access_token_enc": encrypt(token),
    }
    resp = (
        admin.table("integrations")
        .upsert(
            {
                "user_id": user_id,
                "type": "shopify",
                "config": config,
                "is_active": True,
                "deleted_at": None,
                "updated_at": _now_iso(),
            },
            on_conflict="user_id,type",
        )
        .execute()
    )
    if not resp.data:
        raise RuntimeError("Failed to save Shopify integration.")
    return resp.data[0]


def get_shopify_integration(user_id: str) -> Optional[dict]:
    """Return decrypted Shopify credentials, or None if unavailable."""
    admin = get_admin_client()
    resp = (
        admin.table("integrations")
        .select("config")
        .eq("user_id", user_id)
        .eq("type", "shopify")
        .eq("is_active", True)
        .eq("feature_enabled", True)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None

    config = resp.data[0].get("config") or {}
    enc_token = (config.get("access_token_enc") or "").strip()
    store_url = _normalize_store_url(config.get("store_url") or "")
    if not enc_token or not store_url:
        return None

    try:
        return {
            "store_url": store_url,
            "access_token": decrypt(enc_token),
        }
    except Exception as exc:
        logger.error(
            "Failed to decrypt Shopify integration token",
            extra={"user_id": user_id, "error": str(exc)},
        )
        return None


def get_integration_display(user_id: str) -> Optional[dict]:
    """Return Shopify integration state safe for frontend display."""
    admin = get_admin_client()
    resp = (
        admin.table("integrations")
        .select("id,type,config,is_active,feature_enabled,updated_at")
        .eq("user_id", user_id)
        .eq("type", "shopify")
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None

    row = resp.data[0]
    config = row.get("config") or {}
    return {
        "id": row.get("id"),
        "type": "shopify",
        "store_url": _normalize_store_url(config.get("store_url") or ""),
        "token_saved": bool(config.get("access_token_enc")),
        "is_active": bool(row.get("is_active")),
        "feature_enabled": bool(row.get("feature_enabled")),
        "updated_at": row.get("updated_at"),
    }


def delete_shopify_integration(user_id: str) -> None:
    admin = get_admin_client()
    admin.table("integrations").update(
        {"is_active": False, "deleted_at": _now_iso(), "updated_at": _now_iso()}
    ).eq("user_id", user_id).eq("type", "shopify").execute()


def set_shopify_feature_enabled(user_id: str, enabled: bool) -> dict:
    admin = get_admin_client()
    resp = (
        admin.table("integrations")
        .update({"feature_enabled": enabled, "updated_at": _now_iso()})
        .eq("user_id", user_id)
        .eq("type", "shopify")
        .is_("deleted_at", "null")
        .execute()
    )
    if not resp.data:
        raise RuntimeError("Shopify integration not found for user.")
    return {"status": "updated", "feature_enabled": bool(enabled)}

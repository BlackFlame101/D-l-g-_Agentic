"""Lightweight persistent contact memory helpers."""

from __future__ import annotations

import re
from typing import Any

from core.logging import get_logger
from services.supabase import get_admin_client

logger = get_logger(__name__)

EMPTY_MEMORY = {
    "name": None,
    "language": None,
    "preferences": [],
    "order_context": [],
}


def _dedupe_keep_recent(items: list[str], limit: int = 5) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in reversed(items):
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item.strip())
        if len(out) >= limit:
            break
    return list(reversed(out))


def _extract_name(text: str) -> str | None:
    patterns = [
        r"\bmy name is\s+([A-Za-z][A-Za-z' -]{1,40})",
        r"\bi am\s+([A-Za-z][A-Za-z' -]{1,40})",
        r"\bje m[' ]appelle\s+([A-Za-z][A-Za-z' -]{1,40})",
    ]
    lowered = text.strip()
    for pattern in patterns:
        match = re.search(pattern, lowered, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def _detect_language(text: str) -> str | None:
    if re.search(r"[\u0600-\u06FF]", text or ""):
        return "ar"
    lowered = (text or "").lower()
    if any(word in lowered for word in ("bonjour", "merci", "prix", "commande", "livraison")):
        return "fr"
    if any(word in lowered for word in ("hello", "price", "order", "delivery", "thanks")):
        return "en"
    return None


def load_contact_memory(conversation_id: str) -> dict[str, Any]:
    admin = get_admin_client()
    resp = (
        admin.table("conversations")
        .select("contact_memory")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return dict(EMPTY_MEMORY)
    row = resp.data[0]
    return row.get("contact_memory") or dict(EMPTY_MEMORY)


def save_contact_memory(conversation_id: str, memory: dict[str, Any]) -> None:
    admin = get_admin_client()
    try:
        admin.table("conversations").update({"contact_memory": memory}).eq(
            "id", conversation_id
        ).execute()
    except Exception as exc:
        logger.warning(
            "Failed to persist contact memory",
            extra={"conversation_id": conversation_id, "error": str(exc)},
        )


def format_memory_for_prompt(memory: dict[str, Any]) -> str:
    if not memory or not any(memory.values()):
        return ""
    parts = ["RETURNING CUSTOMER CONTEXT:"]
    if memory.get("name"):
        parts.append(f"- Name: {memory['name']}")
    if memory.get("language"):
        parts.append(f"- Preferred language: {memory['language']}")
    preferences = memory.get("preferences") or []
    if preferences:
        parts.append(f"- Known preferences: {', '.join(preferences[:3])}")
    order_context = memory.get("order_context") or []
    if order_context:
        parts.append(f"- Previous order context: {', '.join(order_context[-3:])}")
    return "\n".join(parts)


def update_contact_memory(conversation_id: str, user_message: str, assistant_reply: str) -> None:
    """Best-effort structured memory update after each turn."""
    memory = load_contact_memory(conversation_id)

    language = _detect_language(user_message)
    if language:
        memory["language"] = language

    name = _extract_name(user_message)
    if name:
        memory["name"] = name

    preferences = list(memory.get("preferences") or [])
    lowered = (user_message or "").lower()
    if any(
        token in lowered
        for token in ("i like", "i want", "prefer", "je veux", "j'aime", "bghit")
    ):
        snippet = (user_message or "").strip()[:120]
        if snippet:
            preferences.append(snippet)
    memory["preferences"] = _dedupe_keep_recent(preferences, limit=5)

    order_context = list(memory.get("order_context") or [])
    order_numbers = re.findall(r"#?\d{3,}", f"{user_message}\n{assistant_reply}")
    for order_number in order_numbers:
        order_context.append(order_number if order_number.startswith("#") else f"#{order_number}")
    memory["order_context"] = _dedupe_keep_recent(order_context, limit=5)

    save_contact_memory(conversation_id, memory)

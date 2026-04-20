"""HTTP client for the WhatsApp bridge (Node.js Baileys service)."""

from __future__ import annotations

import httpx

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


class BridgeError(Exception):
    """Raised when the bridge returns a non-2xx response."""


def send_whatsapp_reply(user_id: str, to: str, message: str) -> None:
    """Push a reply to the bridge to be delivered to the WhatsApp contact.

    ``to`` must be the JID the bridge reported on the inbound message so
    Baileys addresses the right conversation.
    """
    if not message or not message.strip():
        logger.warning("Refusing to send empty WhatsApp reply", extra={"user_id": user_id})
        return

    base_url = settings.whatsapp_bridge_url.rstrip("/")
    url = f"{base_url}/api/session/{user_id}/send"
    headers = {
        "Content-Type": "application/json",
        "X-API-Secret": settings.whatsapp_bridge_api_secret,
    }
    payload = {"to": to, "message": message}

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.error(
            "Bridge send failed",
            extra={
                "error": str(exc),
                "user_id": user_id,
                "bridge_url": base_url,
                "target_url": url,
            },
        )
        raise BridgeError(str(exc)) from exc

    if resp.status_code >= 400:
        logger.error(
            "Bridge returned error",
            extra={
                "status": resp.status_code,
                "body": resp.text,
                "user_id": user_id,
                "bridge_url": base_url,
                "target_url": url,
            },
        )
        raise BridgeError(f"Bridge returned {resp.status_code}: {resp.text}")

    logger.debug("Reply forwarded to bridge", extra={"user_id": user_id, "to": to})

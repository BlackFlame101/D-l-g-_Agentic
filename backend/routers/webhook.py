"""WhatsApp bridge webhook router."""

from __future__ import annotations

import base64
import hashlib
import hmac as hmac_lib
import json
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.config import settings
from core.logging import get_logger
from core.webhook_auth import verify_bridge_secret
from schemas.webhook import WebhookAck, WhatsAppWebhookPayload
from services.bridge import send_whatsapp_reply
from services.conversations import (
    get_active_agent_for_user,
    has_message_with_whatsapp_id,
    pause_conversation_for_human_takeover,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/api/webhook", tags=["webhook"])


class WhatsAppTakeoverPayload(BaseModel):
    """Payload used when the owner sends a manual message from WhatsApp."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    user_id: str = Field(alias="userId")
    sender_phone: str = Field(alias="senderPhone")
    sender_name: str | None = Field(default=None, alias="senderName")
    sender_jid: str | None = Field(default=None, alias="senderJid")

    @field_validator("sender_phone", mode="before")
    @classmethod
    def normalize_sender_phone(cls, value: str) -> str:
        digits = "".join(ch for ch in str(value or "") if ch.isdigit())
        if digits.startswith("0"):
            digits = "212" + digits[1:]
        return digits


@router.post(
    "/whatsapp",
    response_model=WebhookAck,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_bridge_secret)],
)
async def whatsapp_webhook(payload: WhatsAppWebhookPayload) -> WebhookAck:
    """Accept a message from the bridge and dispatch async processing.

    The handler returns immediately so the Node.js bridge isn't held up by
    Gemini latency. Heavy lifting happens in ``process_whatsapp_message``.
    """
    from services.tasks import process_whatsapp_message

    if has_message_with_whatsapp_id(payload.message_id):
        logger.info(
            "Webhook duplicate skipped",
            extra={
                "user_id": payload.user_id,
                "sender_phone": payload.sender_phone,
                "message_id": payload.message_id,
            },
        )
        return WebhookAck(accepted=True, task_id=None)

    task = process_whatsapp_message.delay(payload.model_dump(mode="json"))

    logger.info(
        "Webhook accepted",
        extra={
            "user_id": payload.user_id,
            "sender_phone": payload.sender_phone,
            "message_type": payload.message_type,
            "task_id": task.id,
        },
    )
    return WebhookAck(accepted=True, task_id=task.id)


@router.post(
    "/whatsapp/takeover",
    response_model=WebhookAck,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_bridge_secret)],
)
async def whatsapp_takeover(payload: WhatsAppTakeoverPayload) -> WebhookAck:
    """Pause the current conversation when the business replies manually."""
    agent_row = get_active_agent_for_user(payload.user_id)
    if not agent_row:
        logger.warning(
            "Takeover skipped, no active agent",
            extra={"user_id": payload.user_id, "sender_phone": payload.sender_phone},
        )
        return WebhookAck(accepted=True, task_id=None)

    pause_conversation_for_human_takeover(
        agent_id=agent_row["id"],
        contact_phone=payload.sender_phone,
        contact_name=payload.sender_name,
    )

    logger.info(
        "Conversation paused for human takeover",
        extra={
            "user_id": payload.user_id,
            "agent_id": agent_row["id"],
            "sender_phone": payload.sender_phone,
        },
    )
    return WebhookAck(accepted=True, task_id=None)

# ── Shopify order webhook ─────────────────────────────────────────────────────

def _verify_shopify_webhook(body: bytes, hmac_header: str) -> bool:
    """Verify Shopify HMAC-SHA256 signature on the raw request body."""
    if not settings.shopify_webhook_secret:
        return True  # skip verification in dev if secret not set
    digest = base64.b64encode(
        hmac_lib.new(
            settings.shopify_webhook_secret.encode(),
            body,
            hashlib.sha256,
        ).digest()
    ).decode()
    return hmac_lib.compare_digest(digest, hmac_header or "")


def _normalize_moroccan_phone(raw: str) -> str | None:
    """
    Normalize a phone number to WhatsApp JID format (digits only, no +).
    Handles: 06xxxxxxxx, 07xxxxxxxx, +212xxxxxxxx, 00212xxxxxxxx
    Returns None if the number looks invalid.
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 10:
        digits = "212" + digits[1:]
    # Validate: must be 12 digits starting with 212, or a plausible international number
    if len(digits) >= 10:
        return digits
    return None


def _build_order_message(order: dict) -> str:
    """Build a Darija WhatsApp confirmation message from a Shopify order."""
    order_name = order.get("name", "")
    total = order.get("total_price", "0.00")
    currency = order.get("currency", "MAD")
    customer = order.get("customer") or {}
    first_name = customer.get("first_name") or order.get("shipping_address", {}).get("first_name", "")

    items = order.get("line_items") or []
    product_lines = []
    for item in items[:5]:  # cap at 5 items to keep message short
        qty = item.get("quantity", 1)
        title = item.get("title", "")
        product_lines.append(f"  • {qty}x {title}")
    products_text = "\n".join(product_lines) if product_lines else ""

    greeting = f"Salam {first_name}! 👋" if first_name else "Salam! 👋"

    msg = (
        f"{greeting}\n\n"
        f"✅ Commande dyalk *{order_name}* twaslet b naja7!\n\n"
    )
    if products_text:
        msg += f"🛍️ *Mshtariat:*\n{products_text}\n\n"
    msg += (
        f"💰 *Total:* {total} {currency}\n\n"
        f"Shokran bzaf 3la thiqtek fina! "
        f"Ila 3ndek chi so2al, kteb lina hna. 🙏"
    )
    return msg


@router.post("/shopify/orders/create", status_code=status.HTTP_200_OK)
async def shopify_order_created(request: Request):
    body = await request.body()

    hmac_header = request.headers.get("X-Shopify-Hmac-Sha256", "")
    if not _verify_shopify_webhook(body, hmac_header):
        logger.warning("Shopify webhook HMAC verification failed")
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        import json
        order = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    order_name = order.get("name", "unknown")

    # ── Find which user owns this Shopify store ──────────────────────────
    from services.integrations import get_shopify_integration_by_store
    shop_domain = request.headers.get("X-Shopify-Shop-Domain", "")
    integration = get_shopify_integration_by_store(shop_domain) if shop_domain else None

    if not integration:
        logger.warning(
            "No Delege user found for Shopify store — skipping WhatsApp",
            extra={"shop": shop_domain, "order": order_name},
        )
        return {"status": "skipped", "reason": "no_matching_user"}

    user_id = integration["user_id"]

    # ── Extract and normalize phone ──────────────────────────────────────
    raw_phone = (
        (order.get("shipping_address") or {}).get("phone")
        or (order.get("billing_address") or {}).get("phone")
        or (order.get("customer") or {}).get("phone")
        or order.get("phone")
        or ""
    )
    phone = _normalize_moroccan_phone(raw_phone)
    if not phone:
        logger.info(
            "Shopify order has no usable phone number, skipping",
            extra={"order": order_name, "shop": shop_domain},
        )
        return {"status": "skipped", "reason": "no_phone"}

    # ── Send WhatsApp confirmation ────────────────────────────────────────
    message = _build_order_message(order)
    try:
        await send_whatsapp_reply(user_id=user_id, to=phone, message=message)
        logger.info(
            "Shopify order confirmation sent",
            extra={"order": order_name, "phone": phone[:6] + "****"},
        )
    except Exception as exc:
        logger.error(
            "Failed to send Shopify WhatsApp confirmation",
            extra={"order": order_name, "error": str(exc)},
        )
        return {"status": "error", "reason": "whatsapp_send_failed"}

    return {"status": "sent", "order": order_name}
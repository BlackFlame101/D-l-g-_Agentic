"""WhatsApp bridge webhook router."""

from __future__ import annotations

import base64
import hashlib
import hmac as hmac_lib
import json
import re

import httpx
import redis as redis_lib
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


def _get_redis():
    """Get Redis client for deduplication state."""
    return redis_lib.from_url(settings.redis_url, decode_responses=True)


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


def _build_draft_order_message(order: dict) -> str:
    """Build a Darija WhatsApp message for a new draft order (pending payment)."""
    order_name = order.get("name", "")
    total = order.get("total_price", "0.00")
    currency = order.get("currency", "MAD")
    customer = order.get("customer") or {}
    first_name = (
        customer.get("first_name")
        or (order.get("shipping_address") or {}).get("first_name", "")
    )

    items = order.get("line_items") or []
    product_lines = []
    for item in items[:5]:
        qty = item.get("quantity", 1)
        title = item.get("title", "")
        product_lines.append(f"  • {qty}x {title}")
    products_text = "\n".join(product_lines) if product_lines else ""

    greeting = f"Salam {first_name}! 👋" if first_name else "Salam! 👋"

    msg = (
        f"{greeting}\n\n"
        f"📋 Tlab dyalk *{order_name}* twasalna!\n\n"
    )
    if products_text:
        msg += f"🛍️ *Mshtariat:*\n{products_text}\n\n"
    msg += (
        f"💰 *Total:* {total} {currency}\n\n"
        f"⏳ Ghadi nconfirmiwlek l'commande men ba3d ma nkamlo l-payment. "
        f"Ila 3ndek chi so2al, kteb lina hna. 🙏"
    )
    return msg


def _build_payment_confirmed_message(order: dict) -> str:
    """Build a Darija WhatsApp message when draft order is converted to paid order."""
    order_name = order.get("name", "")
    total = order.get("total_price", "0.00")
    currency = order.get("currency", "MAD")
    customer = order.get("customer") or {}
    first_name = (
        customer.get("first_name")
        or (order.get("shipping_address") or {}).get("first_name", "")
    )

    greeting = f"Salam {first_name}! 👋" if first_name else "Salam! 👋"

    return (
        f"{greeting}\n\n"
        f"✅ *L-payment dyal commande {order_name} twassal!*\n\n"
        f"💰 *Total:* {total} {currency}\n\n"
        f"🚀 Commande dyalk kaytjihez daba. "
        f"Ghadi nessiftiwlak chi update men ba3d. Shokran! 🙏"
    )


@router.post("/shopify/drafts/create", status_code=status.HTTP_200_OK)
async def shopify_draft_order_created(request: Request):
    """
    Receives Shopify 'draft_orders/create' webhook.
    Fires immediately when customer submits a custom checkout form.
    Sends instant 'we received your order' WhatsApp confirmation.
    """
    body = await request.body()

    hmac_header = request.headers.get("X-Shopify-Hmac-Sha256", "")
    if not _verify_shopify_webhook(body, hmac_header):
        logger.warning("Shopify draft order webhook HMAC verification failed")
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        order = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    order_name = order.get("name", "unknown")
    shop_domain = request.headers.get("X-Shopify-Shop-Domain", "")

    from services.integrations import get_shopify_integration_by_store
    integration = get_shopify_integration_by_store(shop_domain) if shop_domain else None
    if not integration:
        logger.warning(
            "No Delege user found for Shopify store — skipping draft order WhatsApp",
            extra={"shop": shop_domain, "order": order_name},
        )
        return {"status": "skipped", "reason": "no_matching_user"}

    user_id = integration["user_id"]

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
            "Draft order has no usable phone number, skipping",
            extra={"order": order_name, "shop": shop_domain},
        )
        return {"status": "skipped", "reason": "no_phone"}

    # Store draft order ID in Redis so the real order handler
    # knows this customer already got a confirmation and sends
    # a payment confirmation instead of a duplicate receipt
    draft_id = str(order.get("id", ""))
    if draft_id:
        _get_redis().setex(
            f"shopify_draft_notified:{draft_id}",
            60 * 60 * 48,  # 48 hours — enough time for owner to convert
            phone,
        )

    message = _build_draft_order_message(order)
    try:
        await send_whatsapp_reply(user_id=user_id, to=phone, message=message)
        logger.info(
            "Draft order confirmation sent",
            extra={"order": order_name, "phone": phone[:6] + "****"},
        )
    except Exception as exc:
        logger.error(
            "Failed to send draft order WhatsApp confirmation",
            extra={"order": order_name, "error": str(exc)},
        )
        return {"status": "error", "reason": "whatsapp_send_failed"}

    return {"status": "sent", "order": order_name}


@router.post("/shopify/orders/create", status_code=status.HTTP_200_OK)
async def shopify_order_created(request: Request):
    """
    Receives Shopify 'orders/create' webhook.
    - If order came from a draft order → sends payment confirmed message
    - If fresh order (standard checkout) → sends full order confirmation
    """
    body = await request.body()

    hmac_header = request.headers.get("X-Shopify-Hmac-Sha256", "")
    if not _verify_shopify_webhook(body, hmac_header):
        logger.warning("Shopify webhook HMAC verification failed")
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        order = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    order_name = order.get("name", "unknown")
    shop_domain = request.headers.get("X-Shopify-Shop-Domain", "")

    from services.integrations import get_shopify_integration_by_store
    integration = get_shopify_integration_by_store(shop_domain) if shop_domain else None
    if not integration:
        logger.warning(
            "No Delege user found for Shopify store — skipping WhatsApp",
            extra={"shop": shop_domain, "order": order_name},
        )
        return {"status": "skipped", "reason": "no_matching_user"}

    user_id = integration["user_id"]

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
            "Order has no usable phone number, skipping",
            extra={"order": order_name, "shop": shop_domain},
        )
        return {"status": "skipped", "reason": "no_phone"}

    # Check if this order was converted from a draft we already notified
    source_draft_id = str(order.get("draft_order_id") or "")
    came_from_draft = False
    if source_draft_id:
        draft_key = f"shopify_draft_notified:{source_draft_id}"
        came_from_draft = bool(_get_redis().get(draft_key))
        if came_from_draft:
            # Clean up — no longer needed
            _get_redis().delete(draft_key)

    if came_from_draft:
        # Customer already got the "we received your order" message
        # Now send the payment confirmation
        message = _build_payment_confirmed_message(order)
        msg_type = "payment_confirmation"
    else:
        # Fresh order from standard checkout — send full confirmation
        message = _build_order_message(order)
        msg_type = "order_confirmation"

    try:
        await send_whatsapp_reply(user_id=user_id, to=phone, message=message)
        logger.info(
            f"Shopify {msg_type} sent",
            extra={"order": order_name, "phone": phone[:6] + "****"},
        )
    except Exception as exc:
        logger.error(
            f"Failed to send Shopify {msg_type}",
            extra={"order": order_name, "error": str(exc)},
        )
        return {"status": "error", "reason": "whatsapp_send_failed"}

    return {"status": "sent", "type": msg_type, "order": order_name}
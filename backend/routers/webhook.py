"""WhatsApp bridge webhook router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from core.logging import get_logger
from core.webhook_auth import verify_bridge_secret
from schemas.webhook import WebhookAck, WhatsAppWebhookPayload

logger = get_logger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["webhook"])


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

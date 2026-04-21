"""WhatsApp bridge webhook router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field

from core.logging import get_logger
from core.webhook_auth import verify_bridge_secret
from schemas.webhook import WebhookAck, WhatsAppWebhookPayload
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

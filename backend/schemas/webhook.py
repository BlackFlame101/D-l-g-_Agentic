"""Payload schemas for the WhatsApp bridge webhook."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class WhatsAppWebhookPayload(BaseModel):
    """Payload sent by the WhatsApp bridge for every inbound message.

    Keys are camelCase to match the bridge's JSON contract. A handful of aliases
    exist so the FastAPI route can expose a consistent snake_case interface in
    Python code.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    user_id: str = Field(alias="userId")
    sender_phone: str = Field(alias="senderPhone")
    sender_name: Optional[str] = Field(default=None, alias="senderName")
    sender_jid: str = Field(alias="senderJid")
    message_content: Optional[str] = Field(default=None, alias="messageContent")
    message_type: str = Field(alias="messageType")
    message_id: Optional[str] = Field(default=None, alias="messageId")
    timestamp: Optional[int] = None


class WebhookAck(BaseModel):
    """Response returned to the bridge after enqueueing a job."""

    accepted: bool = True
    task_id: Optional[str] = None

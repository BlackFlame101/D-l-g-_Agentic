"""Schemas for the /api/agents endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AgentBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    system_prompt: Optional[str] = Field(default=None, max_length=8000)
    language: Optional[str] = Field(default=None, max_length=8)
    tone: Optional[str] = Field(default=None, max_length=64)
    greeting_message: Optional[str] = Field(default=None, max_length=2000)
    fallback_message: Optional[str] = Field(default=None, max_length=2000)
    is_active: bool = True


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    system_prompt: Optional[str] = Field(default=None, max_length=8000)
    language: Optional[str] = Field(default=None, max_length=8)
    tone: Optional[str] = Field(default=None, max_length=64)
    greeting_message: Optional[str] = Field(default=None, max_length=2000)
    fallback_message: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None


class AgentOut(AgentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

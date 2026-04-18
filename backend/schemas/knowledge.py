"""Schemas for /api/agents/{agent_id}/knowledge endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeIndexRequest(BaseModel):
    """Request body for registering an already-uploaded storage object."""

    storage_path: str = Field(min_length=1, max_length=1024)
    file_name: str = Field(min_length=1, max_length=255)
    file_type: str = Field(min_length=1, max_length=16)
    file_size_bytes: Optional[int] = Field(default=None, ge=0)


class KnowledgeBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_id: UUID
    file_name: str
    file_url: str
    file_type: str
    file_size_bytes: Optional[int] = None
    status: Optional[str] = None
    error_message: Optional[str] = None
    chunk_count: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

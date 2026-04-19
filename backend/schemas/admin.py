"""Schemas for the /api/admin endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdminPlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    display_name: str
    description: Optional[str] = None
    price_mad: float
    message_limit: int
    features: List[str] = Field(default_factory=list)
    is_active: bool = True


class AdminSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    plan_id: Optional[UUID] = None
    status: str
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    message_limit: int
    current_usage: int
    activated_by: Optional[UUID] = None
    activated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class AdminUserUsageDay(BaseModel):
    date: date
    messages_sent: int
    tokens_consumed: int


class AdminUserOut(BaseModel):
    """Single user as seen by an admin (joined with latest sub + email)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: Optional[str] = None
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    language_preference: Optional[str] = None
    is_admin: bool = False
    created_at: Optional[datetime] = None
    last_sign_in_at: Optional[datetime] = None

    subscription: Optional[AdminSubscriptionOut] = None
    messages_last_30d: int = 0
    tokens_last_30d: int = 0


class AdminUserDetail(AdminUserOut):
    """User detail with full subscription history + per-day usage."""

    subscriptions: List[AdminSubscriptionOut] = Field(default_factory=list)
    usage: List[AdminUserUsageDay] = Field(default_factory=list)


class AdminSubscriptionCreate(BaseModel):
    """Body for activating a subscription on behalf of a user."""

    user_id: UUID
    plan_id: UUID
    payment_method: str = Field(pattern="^(bank_transfer|cashplus|cash)$")
    payment_reference: Optional[str] = Field(default=None, max_length=200)
    expires_at: datetime
    message_limit: Optional[int] = Field(
        default=None,
        ge=0,
        description="Override plan message_limit. Defaults to plan's value.",
    )


class AdminSubscriptionUpdate(BaseModel):
    """Body for updating an existing subscription."""

    status: Optional[str] = Field(
        default=None,
        pattern="^(pending|active|expired|cancelled)$",
    )
    expires_at: Optional[datetime] = None
    payment_reference: Optional[str] = Field(default=None, max_length=200)
    message_limit: Optional[int] = Field(default=None, ge=0)
    current_usage: Optional[int] = Field(default=None, ge=0)


class AdminStatsOut(BaseModel):
    """Aggregate metrics for the admin dashboard home."""

    total_users: int
    active_subscriptions: int
    pending_subscriptions: int
    expiring_soon: int  # active subs expiring in <= 7 days
    messages_last_30d: int
    estimated_mrr_mad: float

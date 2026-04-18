"""Shared-secret authentication for the internal WhatsApp bridge webhook."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from core.config import settings


async def verify_bridge_secret(
    x_api_secret: str | None = Header(default=None, alias="X-API-Secret"),
) -> None:
    """Reject webhook calls that don't come from the trusted bridge."""
    expected = settings.whatsapp_bridge_api_secret
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bridge secret is not configured on the server.",
        )
    if not x_api_secret or not hmac.compare_digest(x_api_secret, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bridge secret.",
        )

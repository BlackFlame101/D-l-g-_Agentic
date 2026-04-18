"""Supabase JWT authentication dependencies for dashboard-facing endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.logging import get_logger
from services.supabase import get_admin_client, get_user_client

logger = get_logger(__name__)
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    """Authenticated principal for dashboard endpoints."""

    id: str
    email: Optional[str]
    is_admin: bool
    access_token: str


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    """Validate the Supabase bearer token and return the authenticated user.

    Verification is delegated to ``supabase.auth.get_user`` so we always honour
    Supabase's own session/expiry checks. The ``is_admin`` flag is pulled from
    ``public.users`` via the service-role client.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        user_client = get_user_client(token)
        resp = user_client.auth.get_user(token)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Token verification failed", extra={"error": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = getattr(resp, "user", None)
    if user is None or not getattr(user, "id", None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    is_admin = False
    try:
        admin = get_admin_client()
        row = (
            admin.table("users")
            .select("is_admin")
            .eq("id", user.id)
            .limit(1)
            .execute()
        )
        if row.data:
            is_admin = bool(row.data[0].get("is_admin"))
    except Exception as exc:  # pragma: no cover - non-fatal
        logger.warning("Failed to load admin flag", extra={"error": str(exc)})

    return CurrentUser(
        id=str(user.id),
        email=getattr(user, "email", None),
        is_admin=is_admin,
        access_token=token,
    )


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency that only allows admin users through."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user

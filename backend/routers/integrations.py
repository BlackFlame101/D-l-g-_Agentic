"""Integration connection endpoints for dashboard users."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from core.config import settings
from core.logging import get_logger
from core.security import CurrentUser, get_current_user
from services.integrations import (
    delete_shopify_integration,
    get_integration_display,
    save_shopify_integration,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# Redis client — reuse the same URL already in settings
import redis

_redis = redis.from_url(settings.redis_url, decode_responses=True)
_OAUTH_STATE_TTL = 600  # 10 minutes


# ── Pydantic models ──────────────────────────────────────────────────────────

class ShopifyConnectRequest(BaseModel):
    store_url: str = Field(min_length=3, max_length=255)
    access_token: str = Field(min_length=10, max_length=512)


class ShopifyIntegrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str | None = None
    type: str = "shopify"
    store_url: str = ""
    token_saved: bool = False
    is_active: bool = False
    feature_enabled: bool = False
    updated_at: str | None = None
    connected: bool = False


# ── Existing manual-token endpoints (keep for backwards compat) ──────────────

@router.get("/shopify", response_model=ShopifyIntegrationOut)
async def get_shopify(user: CurrentUser = Depends(get_current_user)) -> ShopifyIntegrationOut:
    row = get_integration_display(user.id)
    if not row:
        return ShopifyIntegrationOut(connected=False)
    return ShopifyIntegrationOut(**row, connected=True)


@router.post("/shopify", response_model=ShopifyIntegrationOut, status_code=status.HTTP_201_CREATED)
async def connect_shopify(
    body: ShopifyConnectRequest,
    user: CurrentUser = Depends(get_current_user),
) -> ShopifyIntegrationOut:
    try:
        save_shopify_integration(user.id, body.store_url, body.access_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = get_integration_display(user.id)
    if not row:
        raise HTTPException(status_code=500, detail="Integration saved but could not be read back.")
    return ShopifyIntegrationOut(**row, connected=True)


@router.delete("/shopify", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_shopify(user: CurrentUser = Depends(get_current_user)) -> None:
    delete_shopify_integration(user.id)


# ── OAuth flow ────────────────────────────────────────────────────────────────

@router.get("/shopify/oauth/start")
async def shopify_oauth_start(
    shop: str = Query(..., description="e.g. mystore.myshopify.com"),
    token: str = Query(..., description="Supabase access token"),
):
    if not settings.shopify_client_id:
        raise HTTPException(status_code=500, detail="Shopify OAuth is not configured.")

    # Verify the token manually (browser redirect can't send Authorization header)
    try:
        from services.supabase import get_user_client
        user_client = get_user_client(token)
        resp = user_client.auth.get_user(token)
        user = getattr(resp, "user", None)
        if not user or not getattr(user, "id", None):
            raise HTTPException(status_code=401, detail="Invalid or expired token.")
        user_id = str(user.id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token.") from exc

    # Normalize shop domain
    shop = shop.strip().lower().replace("https://", "").replace("http://", "").strip("/")
    if not shop.endswith(".myshopify.com"):
        shop = f"{shop}.myshopify.com"

    # Store state in Redis: state_token -> user_id
    state = secrets.token_urlsafe(32)
    _get_redis().setex(f"shopify_oauth_state:{state}", _OAUTH_STATE_TTL, user_id)

    params = urllib.parse.urlencode({
        "client_id": settings.shopify_client_id,
        "scope": settings.shopify_app_scopes,
        "redirect_uri": settings.shopify_redirect_uri,
        "state": state,
    })
    return RedirectResponse(url=f"https://{shop}/admin/oauth/authorize?{params}")

@router.get("/shopify/oauth/callback")
async def shopify_oauth_callback(
    request: Request,
    shop: str = Query(...),
    code: str = Query(...),
    state: str = Query(...),
    hmac_param: str = Query(alias="hmac"),
):
    """
    Shopify redirects here after the merchant approves.
    We verify HMAC + state, exchange the code for a token, save it.
    """
    # 1. Verify HMAC from Shopify
    query_params = dict(request.query_params)
    query_params.pop("hmac", None)
    sorted_params = "&".join(
        f"{k}={v}" for k, v in sorted(query_params.items())
    )
    expected_hmac = hmac.new(
        settings.shopify_client_secret.encode(),
        sorted_params.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_hmac, hmac_param):
        raise HTTPException(status_code=400, detail="Invalid HMAC signature.")

    # 2. Verify state and retrieve user_id
    redis_key = f"shopify_oauth_state:{state}"
    user_id = _redis.get(redis_key)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")
    _redis.delete(redis_key)

    # 3. Exchange code for permanent access token
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://{shop}/admin/oauth/access_token",
            json={
                "client_id": settings.shopify_client_id,
                "client_secret": settings.shopify_client_secret,
                "code": code,
            },
            timeout=10,
        )
    if resp.status_code != 200:
        logger.error("Shopify token exchange failed", extra={"shop": shop, "status": resp.status_code})
        raise HTTPException(status_code=502, detail="Failed to exchange Shopify OAuth code.")

    access_token = resp.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="No access token in Shopify response.")

    # 4. Save encrypted token (reuse existing service)
    try:
        save_shopify_integration(
            user_id=user_id,
            store_url=shop,
            access_token=access_token,
        )
    except Exception as exc:
        logger.error("Failed to save Shopify OAuth token", extra={"user_id": user_id, "error": str(exc)})
        raise HTTPException(status_code=500, detail="Failed to save integration.") from exc

    logger.info("Shopify OAuth connected", extra={"user_id": user_id, "shop": shop})

    # 5. Redirect back to the frontend dashboard
    return RedirectResponse(
        url=f"{settings.frontend_app_url}/dashboard/integrations?shopify=connected"
    )
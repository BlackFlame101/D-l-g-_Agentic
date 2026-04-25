"""Integration connection endpoints for dashboard users."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from core.security import CurrentUser, get_current_user
from services.integrations import (
    delete_shopify_integration,
    get_integration_display,
    save_shopify_integration,
)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


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
        save_shopify_integration(
            user_id=user.id,
            store_url=body.store_url,
            access_token=body.access_token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = get_integration_display(user.id)
    if not row:
        raise HTTPException(status_code=500, detail="Integration saved but could not be read back.")
    return ShopifyIntegrationOut(**row, connected=True)


@router.delete("/shopify", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_shopify(user: CurrentUser = Depends(get_current_user)) -> None:
    delete_shopify_integration(user.id)

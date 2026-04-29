"""Admin endpoints for managing users and subscriptions.

All routes require ``users.is_admin = true`` via the ``require_admin``
dependency. The service-role Supabase client is used throughout to bypass
RLS, since admins legitimately need cross-user visibility.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.logging import get_logger
from core.security import CurrentUser, require_admin
from schemas.admin import (
    AdminPlanOut,
    AdminStatsOut,
    AdminSubscriptionCreate,
    AdminSubscriptionOut,
    AdminSubscriptionUpdate,
    AdminUserDetail,
    AdminUserOut,
    AdminUserUsageDay,
)
from services.supabase import get_admin_client
from services.integrations import set_shopify_feature_enabled, get_integration_display

logger = get_logger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_email_index(user_ids: List[str]) -> Dict[str, Dict[str, Optional[str]]]:
    """Look up email + last_sign_in_at from auth.users for the given ids."""
    if not user_ids:
        return {}
    admin = get_admin_client()
    try:
        users_page = admin.auth.admin.list_users(per_page=1000)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not list auth users", extra={"error": str(exc)})
        return {}

    wanted = set(user_ids)
    out: Dict[str, Dict[str, Optional[str]]] = {}
    for u in users_page or []:
        uid = str(getattr(u, "id", "") or "")
        if uid not in wanted:
            continue
        out[uid] = {
            "email": getattr(u, "email", None),
            "last_sign_in_at": getattr(u, "last_sign_in_at", None),
        }
    return out


def _latest_subscription_per_user(user_ids: List[str]) -> Dict[str, dict]:
    """Return the most recent (non-deleted) subscription for each user."""
    if not user_ids:
        return {}
    admin = get_admin_client()
    resp = (
        admin.table("subscriptions")
        .select("*")
        .in_("user_id", user_ids)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    out: Dict[str, dict] = {}
    for row in resp.data or []:
        uid = str(row.get("user_id"))
        if uid not in out:  # rows are sorted desc; first wins
            out[uid] = row
    return out


def _usage_totals_per_user(
    user_ids: List[str], days: int = 30
) -> Dict[str, Dict[str, int]]:
    if not user_ids:
        return {}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    admin = get_admin_client()
    resp = (
        admin.table("usage_logs")
        .select("user_id,messages_sent,tokens_consumed,date")
        .in_("user_id", user_ids)
        .gte("date", cutoff)
        .execute()
    )
    totals: Dict[str, Dict[str, int]] = {}
    for row in resp.data or []:
        uid = str(row.get("user_id"))
        bucket = totals.setdefault(uid, {"messages": 0, "tokens": 0})
        bucket["messages"] += int(row.get("messages_sent") or 0)
        bucket["tokens"] += int(row.get("tokens_consumed") or 0)
    return totals


def _serialize_subscription(row: dict) -> AdminSubscriptionOut:
    return AdminSubscriptionOut.model_validate(row)


def _serialize_user(
    profile: dict,
    auth_info: Dict[str, Optional[str]] | None,
    sub: Optional[dict],
    usage: Dict[str, int] | None,
) -> AdminUserOut:
    auth_info = auth_info or {}
    usage = usage or {}
    return AdminUserOut(
        id=profile["id"],
        email=auth_info.get("email"),
        full_name=profile.get("full_name"),
        company_name=profile.get("company_name"),
        phone=profile.get("phone"),
        language_preference=profile.get("language_preference"),
        is_admin=bool(profile.get("is_admin")),
        created_at=profile.get("created_at"),
        last_sign_in_at=auth_info.get("last_sign_in_at"),
        subscription=_serialize_subscription(sub) if sub else None,
        messages_last_30d=int(usage.get("messages") or 0),
        tokens_last_30d=int(usage.get("tokens") or 0),
    )


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------


@router.get("/plans", response_model=List[AdminPlanOut])
async def list_plans(
    _admin: CurrentUser = Depends(require_admin),
    only_active: bool = Query(default=True),
) -> List[AdminPlanOut]:
    admin = get_admin_client()
    query = admin.table("plans").select("*").order("price_mad")
    if only_active:
        query = query.eq("is_active", True)
    resp = query.execute()
    return [AdminPlanOut.model_validate(row) for row in (resp.data or [])]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_model=List[AdminUserOut])
async def list_users(
    _admin: CurrentUser = Depends(require_admin),
    search: Optional[str] = Query(default=None, max_length=120),
    sub_status: Optional[str] = Query(
        default=None, pattern="^(none|pending|active|expired|cancelled)$"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> List[AdminUserOut]:
    admin = get_admin_client()
    query = (
        admin.table("users")
        .select("*")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if search:
        like = f"%{search}%"
        query = query.or_(
            f"full_name.ilike.{like},company_name.ilike.{like},phone.ilike.{like}"
        )
    profiles = query.execute().data or []
    if not profiles:
        return []

    user_ids = [str(p["id"]) for p in profiles]
    auth_index = _build_email_index(user_ids)
    subs = _latest_subscription_per_user(user_ids)
    usage = _usage_totals_per_user(user_ids)

    results: List[AdminUserOut] = []
    for p in profiles:
        uid = str(p["id"])
        sub = subs.get(uid)
        if sub_status:
            current = (sub or {}).get("status") if sub else "none"
            if sub_status == "none" and sub is not None:
                continue
            if sub_status != "none" and current != sub_status:
                continue
        results.append(
            _serialize_user(p, auth_index.get(uid), sub, usage.get(uid))
        )
    return results


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: UUID,
    _admin: CurrentUser = Depends(require_admin),
) -> AdminUserDetail:
    admin = get_admin_client()
    profile_resp = (
        admin.table("users")
        .select("*")
        .eq("id", str(user_id))
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not profile_resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    profile = profile_resp.data[0]
    uid = str(user_id)

    auth_index = _build_email_index([uid])
    auth_info = auth_index.get(uid, {})

    subs_resp = (
        admin.table("subscriptions")
        .select("*")
        .eq("user_id", uid)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    sub_rows = subs_resp.data or []
    latest_sub = sub_rows[0] if sub_rows else None

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    usage_resp = (
        admin.table("usage_logs")
        .select("date,messages_sent,tokens_consumed")
        .eq("user_id", uid)
        .gte("date", cutoff)
        .order("date")
        .execute()
    )
    usage_rows = [AdminUserUsageDay.model_validate(r) for r in (usage_resp.data or [])]
    msgs_total = sum(r.messages_sent for r in usage_rows)
    tok_total = sum(r.tokens_consumed for r in usage_rows)

    return AdminUserDetail(
        id=profile["id"],
        email=auth_info.get("email"),
        full_name=profile.get("full_name"),
        company_name=profile.get("company_name"),
        phone=profile.get("phone"),
        language_preference=profile.get("language_preference"),
        is_admin=bool(profile.get("is_admin")),
        created_at=profile.get("created_at"),
        last_sign_in_at=auth_info.get("last_sign_in_at"),
        subscription=_serialize_subscription(latest_sub) if latest_sub else None,
        messages_last_30d=msgs_total,
        tokens_last_30d=tok_total,
        subscriptions=[_serialize_subscription(r) for r in sub_rows],
        usage=usage_rows,
    )


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------


@router.post(
    "/subscriptions",
    response_model=AdminSubscriptionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_subscription(
    payload: AdminSubscriptionCreate,
    admin_user: CurrentUser = Depends(require_admin),
) -> AdminSubscriptionOut:
    """Activate a subscription on behalf of a user.

    Cancels any existing non-deleted subscription for that user first so the
    UI always has a single source of truth for "current plan".
    """
    admin = get_admin_client()

    user_resp = (
        admin.table("users")
        .select("id")
        .eq("id", str(payload.user_id))
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not user_resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    plan_resp = (
        admin.table("plans")
        .select("*")
        .eq("id", str(payload.plan_id))
        .limit(1)
        .execute()
    )
    if not plan_resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found.")
    plan = plan_resp.data[0]

    now = _now_iso()
    try:
        admin.table("subscriptions").update(
            {"status": "cancelled", "updated_at": now}
        ).eq("user_id", str(payload.user_id)).is_("deleted_at", "null").in_(
            "status", ["pending", "active"]
        ).execute()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Could not cancel previous subscriptions",
            extra={"user_id": str(payload.user_id), "error": str(exc)},
        )

    insert_data = {
        "user_id": str(payload.user_id),
        "plan_id": str(payload.plan_id),
        "status": "active",
        "payment_method": payload.payment_method,
        "payment_reference": payload.payment_reference,
        "message_limit": int(payload.message_limit or plan.get("message_limit") or 0),
        "current_usage": 0,
        "activated_by": admin_user.id,
        "activated_at": now,
        "expires_at": payload.expires_at.isoformat(),
    }
    resp = admin.table("subscriptions").insert(insert_data).execute()
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create subscription.",
        )

    try:
        admin.table("agents").update({"is_active": True, "updated_at": now}).eq(
            "user_id", str(payload.user_id)
        ).is_("deleted_at", "null").execute()
    except Exception as exc:  # pragma: no cover
        logger.warning("Could not reactivate agents", extra={"error": str(exc)})

    logger.info(
        "Subscription activated",
        extra={
            "user_id": str(payload.user_id),
            "plan_id": str(payload.plan_id),
            "activated_by": admin_user.id,
        },
    )
    return _serialize_subscription(resp.data[0])


@router.put("/subscriptions/{sub_id}", response_model=AdminSubscriptionOut)
async def update_subscription(
    sub_id: UUID,
    payload: AdminSubscriptionUpdate,
    _admin: CurrentUser = Depends(require_admin),
) -> AdminSubscriptionOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update.",
        )
    if "expires_at" in updates and isinstance(updates["expires_at"], datetime):
        updates["expires_at"] = updates["expires_at"].isoformat()
    updates["updated_at"] = _now_iso()

    admin = get_admin_client()
    resp = (
        admin.table("subscriptions")
        .update(updates)
        .eq("id", str(sub_id))
        .execute()
    )
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found.",
        )
    return _serialize_subscription(resp.data[0])


@router.delete("/subscriptions/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_subscription(
    sub_id: UUID,
    _admin: CurrentUser = Depends(require_admin),
) -> None:
    admin = get_admin_client()
    now = _now_iso()
    sub_resp = (
        admin.table("subscriptions")
        .select("user_id")
        .eq("id", str(sub_id))
        .limit(1)
        .execute()
    )
    if not sub_resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found.",
        )
    user_id = sub_resp.data[0].get("user_id")

    admin.table("subscriptions").update(
        {"status": "cancelled", "deleted_at": now, "updated_at": now}
    ).eq("id", str(sub_id)).execute()

    if user_id:
        try:
            admin.table("agents").update(
                {"is_active": False, "updated_at": now}
            ).eq("user_id", user_id).is_("deleted_at", "null").execute()
        except Exception as exc:  # pragma: no cover
            logger.warning("Could not deactivate agents", extra={"error": str(exc)})


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=AdminStatsOut)
async def get_stats(_admin: CurrentUser = Depends(require_admin)) -> AdminStatsOut:
    admin = get_admin_client()

    total_users = (
        admin.table("users")
        .select("id", count="exact")
        .is_("deleted_at", "null")
        .execute()
        .count
        or 0
    )

    subs_resp = (
        admin.table("subscriptions")
        .select("id,status,expires_at,plan_id,plans(price_mad)")
        .is_("deleted_at", "null")
        .execute()
    )
    sub_rows = subs_resp.data or []

    active = [s for s in sub_rows if s.get("status") == "active"]
    pending = [s for s in sub_rows if s.get("status") == "pending"]

    cutoff_soon = datetime.now(timezone.utc) + timedelta(days=7)
    expiring_soon = 0
    mrr = 0.0
    for s in active:
        plan = s.get("plans") or {}
        try:
            mrr += float(plan.get("price_mad") or 0)
        except (TypeError, ValueError):
            pass
        exp = s.get("expires_at")
        if exp:
            try:
                exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                if exp_dt <= cutoff_soon:
                    expiring_soon += 1
            except ValueError:
                pass

    cutoff_30 = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    usage_resp = (
        admin.table("usage_logs")
        .select("messages_sent")
        .gte("date", cutoff_30)
        .execute()
    )
    msgs_30 = sum(int(r.get("messages_sent") or 0) for r in (usage_resp.data or []))

    return AdminStatsOut(
        total_users=int(total_users),
        active_subscriptions=len(active),
        pending_subscriptions=len(pending),
        expiring_soon=expiring_soon,
        messages_last_30d=msgs_30,
        estimated_mrr_mad=round(mrr, 2),
    )


@router.get("/integrations/{user_id}/shopify")
async def get_user_shopify_integration(
    user_id: UUID,
    _admin: CurrentUser = Depends(require_admin),
) -> dict:
    """Get Shopify integration status for a user."""
    user_id_str = str(user_id)
    logger.info("Fetching Shopify integration for user", extra={"user_id": user_id_str})
    integration = get_integration_display(user_id_str)
    if not integration:
        logger.warning("Shopify integration not found for user", extra={"user_id": user_id_str})
        return {"connected": False, "feature_enabled": False}
    logger.info("Shopify integration found", extra={"user_id": user_id_str, "store_url": integration.get("store_url")})
    return {**integration, "connected": True}


@router.patch("/integrations/{user_id}/shopify/enable")
async def toggle_shopify_feature(
    user_id: UUID,
    enabled: bool = Query(...),
    _admin: CurrentUser = Depends(require_admin),
) -> dict:
    try:
        return set_shopify_feature_enabled(str(user_id), enabled)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

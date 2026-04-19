"""E2E: admin activates a subscription, and the agent subsequently replies.

Steps:
1. Admin hits ``POST /api/admin/subscriptions`` with a user, plan and expiry.
2. We assert the subscription row is active and the agent is reactivated.
3. A webhook on behalf of the user now produces a stored user message (no
   blocked-notice) and the mock bridge receives the agent's reply.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

pytestmark = [pytest.mark.e2e]


def test_admin_activation_unlocks_replies(
    api_server,
    celery_worker,
    mock_bridge,
    bridge_webhook,
    authed_client,
    supabase_jwt,
    supabase_admin,
    poll_supabase,
    test_user,
    test_plan,
    test_agent,
    test_session,
    admin_user,
    cleanup_registry,
):
    # Agent starts disabled so we can prove reactivation happens
    supabase_admin.table("agents").update({"is_active": False}).eq(
        "id", test_agent["id"]
    ).execute()

    admin_token = supabase_jwt(admin_user["email"], admin_user["password"])

    with authed_client(admin_token) as client:
        payload = {
            "user_id": test_user["id"],
            "plan_id": test_plan["id"],
            "payment_method": "bank_transfer",
            "payment_reference": f"activation-{uuid.uuid4().hex[:6]}",
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
            "message_limit": 500,
        }
        resp = client.post("/api/admin/subscriptions", json=payload)
    assert resp.status_code == 201, resp.text
    sub = resp.json()
    cleanup_registry["subscriptions"].append(sub["id"])
    assert sub["status"] == "active"
    assert sub["message_limit"] == 500

    # Agent is_active flipped back on
    updated = (
        supabase_admin.table("agents")
        .select("is_active")
        .eq("id", test_agent["id"])
        .limit(1)
        .execute()
    )
    assert updated.data and updated.data[0]["is_active"] is True

    # Now an inbound webhook should go all the way through
    contact_phone = f"2125{uuid.uuid4().int % 10_000_000:08d}"
    wh = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content="Hello",
    )
    assert wh.status_code == 202, wh.text

    convs = poll_supabase(
        "conversations",
        {"agent_id": test_agent["id"], "contact_phone": contact_phone},
        predicate=lambda rows: bool(rows),
        timeout=20.0,
    )
    cleanup_registry["conversations"].append(convs[0]["id"])

    # The bridge gets exactly one message — the greeting (new contact)
    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
    assert sent[0]["message"].strip() == test_agent["greeting_message"].strip()

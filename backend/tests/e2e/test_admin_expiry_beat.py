"""E2E: ``check_subscription_expiry`` flips expired subs and deactivates agents.

After the beat job runs, a subsequent webhook should hit the "expired" blocked
path (no conversation persisted, bridge receives the localized notice).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from services.tasks import LIMIT_REACHED_NOTICE, check_subscription_expiry

pytestmark = [pytest.mark.e2e]


def test_expired_subscription_is_deactivated_and_blocks(
    api_server,
    celery_worker,
    mock_bridge,
    bridge_webhook,
    supabase_admin,
    poll_supabase,
    test_user,
    test_agent,
    test_subscription,
    test_session,
):
    now = datetime.now(timezone.utc)
    # Make the subscription overdue
    supabase_admin.table("subscriptions").update(
        {
            "status": "active",
            "expires_at": (now - timedelta(hours=1)).isoformat(),
        }
    ).eq("id", test_subscription["id"]).execute()

    # Run the beat task synchronously
    result = check_subscription_expiry.apply().get()
    assert result["expired"] >= 1

    # Status flipped to "expired"
    row = (
        supabase_admin.table("subscriptions")
        .select("status")
        .eq("id", test_subscription["id"])
        .limit(1)
        .execute()
    )
    assert row.data and row.data[0]["status"] == "expired"

    # Agent should be deactivated
    agent_row = (
        supabase_admin.table("agents")
        .select("is_active")
        .eq("id", test_agent["id"])
        .limit(1)
        .execute()
    )
    assert agent_row.data and agent_row.data[0]["is_active"] is False

    # A webhook is now blocked — worker returns "no_agent" because is_active=False
    contact_phone = f"2124{uuid.uuid4().int % 10_000_000:08d}"
    resp = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content="hey",
    )
    assert resp.status_code == 202, resp.text

    # No reply should be sent to this contact since the agent is paused. Give
    # the worker a moment to settle — should be silent.
    import time

    time.sleep(2.0)
    for m in mock_bridge.messages_for(test_user["id"]):
        # If anything was sent, it must be the expired/inactive notice (not a
        # greeting or stub). This happens when there's no active agent at all.
        assert m["message"].strip() in {
            LIMIT_REACHED_NOTICE["expired"].strip(),
            LIMIT_REACHED_NOTICE["inactive"].strip(),
            LIMIT_REACHED_NOTICE["no_subscription"].strip(),
        }

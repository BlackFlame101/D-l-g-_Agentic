"""E2E: when ``subscription.current_usage >= message_limit`` the agent stops.

Expected behaviour:
* Webhook returns 202 (accepted for async).
* No assistant message is stored.
* The mock bridge receives the localized limit-reached notice.
* ``usage_logs.messages_sent`` is not bumped by this attempt.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

import pytest

from services.tasks import LIMIT_REACHED_NOTICE

pytestmark = [pytest.mark.e2e]


def test_subscription_limit_blocks_responses(
    api_server,
    celery_worker,
    mock_bridge,
    bridge_webhook,
    supabase_admin,
    test_user,
    test_agent,
    test_subscription,
    test_session,
):
    # Cap the subscription
    supabase_admin.table("subscriptions").update(
        {"current_usage": 25, "message_limit": 25}
    ).eq("id", test_subscription["id"]).execute()

    today_iso = datetime.now(timezone.utc).date().isoformat()
    before = (
        supabase_admin.table("usage_logs")
        .select("messages_sent")
        .eq("user_id", test_user["id"])
        .eq("date", today_iso)
        .execute()
    )
    before_count = int((before.data or [{}])[0].get("messages_sent") or 0)

    contact_phone = f"2129{uuid.uuid4().int % 10_000_000:08d}"
    resp = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content="Please reply",
    )
    assert resp.status_code == 202, resp.text

    # Mock bridge should receive the limit-reached notice (not a greeting)
    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
    notice = LIMIT_REACHED_NOTICE["limit_reached"]
    assert any(m["message"].strip() == notice.strip() for m in sent), sent

    # No conversation should have been created
    time.sleep(1.0)  # let the worker settle
    convs = (
        supabase_admin.table("conversations")
        .select("id")
        .eq("agent_id", test_agent["id"])
        .eq("contact_phone", contact_phone)
        .execute()
    )
    assert not (convs.data or []), "Blocked attempt must not create a conversation"

    # usage_logs.messages_sent should be unchanged
    after = (
        supabase_admin.table("usage_logs")
        .select("messages_sent")
        .eq("user_id", test_user["id"])
        .eq("date", today_iso)
        .execute()
    )
    after_count = int((after.data or [{}])[0].get("messages_sent") or 0)
    assert after_count == before_count

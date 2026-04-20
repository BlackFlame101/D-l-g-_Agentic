"""E2E: recover when subscription is active but agent.is_active drifted false."""

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.e2e]


def test_worker_recovers_agent_active_drift(
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
    cleanup_registry,
):
    # Simulate drift: valid active subscription but agent unexpectedly disabled.
    supabase_admin.table("subscriptions").update({"status": "active"}).eq(
        "id", test_subscription["id"]
    ).execute()
    supabase_admin.table("agents").update({"is_active": False}).eq(
        "id", test_agent["id"]
    ).execute()

    contact_phone = f"2128{uuid.uuid4().int % 10_000_000:08d}"
    wh = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content="Hello from drift state",
    )
    assert wh.status_code == 202, wh.text

    # Worker should reactivate the latest agent and continue normal flow.
    poll_supabase(
        "agents",
        {"id": test_agent["id"]},
        predicate=lambda rows: bool(rows) and bool(rows[0].get("is_active")),
        timeout=20.0,
    )

    convs = poll_supabase(
        "conversations",
        {"agent_id": test_agent["id"], "contact_phone": contact_phone},
        predicate=lambda rows: bool(rows),
        timeout=20.0,
    )
    cleanup_registry["conversations"].append(convs[0]["id"])

    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
    assert sent[0]["message"].strip() == test_agent["greeting_message"].strip()

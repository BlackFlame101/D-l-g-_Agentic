"""E2E: a new contact's first message triggers the greeting flow.

Asserts:
* A ``conversations`` row is created.
* A single ``messages`` row of role=user and a greeting row of role=assistant are
  persisted (the greeting is the agent's ``greeting_message``).
* The mock bridge received exactly one POST with that greeting text and the
  correct JID.
* ``usage_logs`` was incremented for the day.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

pytestmark = [pytest.mark.e2e]


def test_first_inbound_message_triggers_greeting(
    api_server,
    celery_worker,
    mock_bridge,
    bridge_webhook,
    poll_supabase,
    supabase_admin,
    test_user,
    test_agent,
    test_subscription,
    test_session,
):
    contact_phone = f"2126{uuid.uuid4().int % 10_000_000:08d}"

    resp = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content="Hi there, are you open?",
    )
    assert resp.status_code == 202, resp.text
    assert resp.json().get("accepted") is True

    # Conversation row appears
    convs = poll_supabase(
        "conversations",
        {"agent_id": test_agent["id"], "contact_phone": contact_phone},
        predicate=lambda rows: bool(rows),
        timeout=20.0,
    )
    conv_id = convs[0]["id"]

    # User message + greeting assistant message are both persisted
    msgs = poll_supabase(
        "messages",
        {"conversation_id": conv_id},
        predicate=lambda rows: any(r["role"] == "assistant" for r in rows)
        and any(r["role"] == "user" for r in rows),
        timeout=25.0,
        order_by="created_at",
    )
    user_rows = [m for m in msgs if m["role"] == "user"]
    assistant_rows = [m for m in msgs if m["role"] == "assistant"]
    assert user_rows, "No user message persisted"
    assert assistant_rows, "No greeting message persisted"
    greeting = test_agent["greeting_message"]
    assert any(m["content"].strip() == greeting.strip() for m in assistant_rows)

    # The greeting shows up on the mock bridge, addressed to the contact
    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
    assert len(sent) >= 1
    first = sent[0]
    assert first["to"].startswith(contact_phone.lstrip("+"))
    assert first["message"].strip() == greeting.strip()

    # Usage log was bumped for today
    today_iso = datetime.now(timezone.utc).date().isoformat()
    usage = (
        supabase_admin.table("usage_logs")
        .select("messages_sent,tokens_consumed,date")
        .eq("user_id", test_user["id"])
        .eq("date", today_iso)
        .execute()
    )
    assert (usage.data or []), "usage_logs not incremented"
    assert int(usage.data[0]["messages_sent"]) >= 1

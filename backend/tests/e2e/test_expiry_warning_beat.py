"""E2E: ``send_expiry_warnings`` queues ``notify_user_expiry`` for near-expiry subs.

The task body uses ``.delay()`` to enqueue the per-user notifier. We run the
Celery worker in-band so the notification goes all the way to the mock bridge.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest

from services.tasks import send_expiry_warnings

pytestmark = [pytest.mark.e2e]


def test_expiry_warning_sends_localized_notice(
    api_server,
    celery_worker,
    mock_bridge,
    supabase_admin,
    test_user,
    test_agent,
    test_subscription,
    test_session,
):
    now = datetime.now(timezone.utc)
    # Expiry lands inside the [days_before, days_before+24h) window of the task.
    target = now + timedelta(days=3, hours=2)
    supabase_admin.table("subscriptions").update(
        {"status": "active", "expires_at": target.isoformat()}
    ).eq("id", test_subscription["id"]).execute()

    # Prefer French so we can assert on the template
    supabase_admin.table("users").update({"language_preference": "fr"}).eq(
        "id", test_user["id"]
    ).execute()

    result = send_expiry_warnings.apply(kwargs={"days_before": 3}).get()
    assert result["queued"] >= 1

    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=20.0)
    assert any("Delege" in m["message"] and "jour" in m["message"] for m in sent), sent
    # Ensure we addressed the user's own phone (digits only)
    expected_digits = (test_user["phone"] or "").lstrip("+")
    if expected_digits:
        assert any(m["to"].startswith(expected_digits) for m in sent), sent

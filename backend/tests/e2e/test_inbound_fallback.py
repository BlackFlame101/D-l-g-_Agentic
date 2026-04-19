"""E2E: forcing ``TEST_LLM_MODE=stub_error`` makes the agent fall back.

The fallback branch stores ``metadata.kind = "fallback"`` and sends the
agent's configured ``fallback_message`` over the bridge.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import pytest

pytestmark = [pytest.mark.e2e]


BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _wait(url: str, timeout: float = 30.0) -> None:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        try:
            httpx.get(url, timeout=2.0)
            return
        except Exception:
            time.sleep(0.4)
    raise TimeoutError(url)


def test_fallback_path_is_used_when_llm_errors(
    redis_url,
    mock_bridge,
    bridge_api_secret,
    poll_supabase,
    supabase_admin,
    test_user,
    test_agent,
    test_subscription,
    test_session,
    cleanup_registry,
    api_server,  # ensures the session-scoped fixture is also up
):
    """Run an extra api + worker with TEST_LLM_MODE=stub_error.

    We can't simply flip the env on the session-scoped ``celery_worker`` mid-
    test, so this test stands up a dedicated pair of subprocesses with the
    error mode baked in. This is heavier but makes the forced-error contract
    easy to read.
    """
    import socket

    def pick_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    api_port = pick_port()
    # Use a *different* Redis DB than the session-scoped worker so tasks
    # produced by this test's API subprocess can't be stolen by the default
    # session worker (which runs with TEST_LLM_MODE=stub, not stub_error).
    if "/" in redis_url.rsplit(":", 1)[-1]:
        fallback_redis_url = redis_url.rsplit("/", 1)[0] + "/14"
    else:
        fallback_redis_url = redis_url.rstrip("/") + "/14"
    import redis as _redis  # type: ignore

    _redis.Redis.from_url(fallback_redis_url, socket_timeout=2.0).flushdb()

    env = os.environ.copy()
    env["TEST_LLM_MODE"] = "stub_error"
    env["TEST_EMBED_MODE"] = "stub"
    env["CELERY_BROKER_URL"] = fallback_redis_url
    env["CELERY_RESULT_BACKEND"] = fallback_redis_url
    env["REDIS_URL"] = fallback_redis_url
    env["WHATSAPP_BRIDGE_URL"] = mock_bridge.url
    env["WHATSAPP_BRIDGE_API_SECRET"] = bridge_api_secret
    env["PYTHONPATH"] = str(BACKEND_ROOT) + os.pathsep + env.get("PYTHONPATH", "")

    api_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(api_port), "--log-level", "warning"],
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    worker_name = f"pytest-fallback-{uuid.uuid4().hex[:6]}@%h"
    worker_proc = subprocess.Popen(
        [
            sys.executable, "-m", "celery", "-A", "celery_app", "worker",
            "--loglevel=warning", "--pool=solo", "--concurrency=1",
            "-n", worker_name, "-Q", "celery",
            "--without-heartbeat", "--without-gossip", "--without-mingle",
        ],
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait(f"http://127.0.0.1:{api_port}/health")

        # Wait for this worker to respond
        from celery import Celery
        probe = Celery("fallback-probe", broker=fallback_redis_url, backend=fallback_redis_url)
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            if probe.control.ping(timeout=1.0):
                break
            time.sleep(0.4)

        # Pre-create a conversation so greeting path is skipped
        contact_phone = f"2128{uuid.uuid4().int % 10_000_000:08d}"
        conv = supabase_admin.table("conversations").insert(
            {
                "agent_id": test_agent["id"],
                "contact_phone": contact_phone,
                "status": "active",
                "message_count": 0,
            }
        ).execute().data[0]
        cleanup_registry["conversations"].append(conv["id"])
        supabase_admin.table("messages").insert(
            {"conversation_id": conv["id"], "role": "assistant", "content": "Bonjour"}
        ).execute()

        # Fire a webhook
        body = {
            "userId": test_user["id"],
            "senderPhone": contact_phone,
            "senderName": "Err Tester",
            "senderJid": f"{contact_phone}@s.whatsapp.net",
            "messageContent": "Tell me something",
            "messageType": "text",
            "messageId": f"mid-{uuid.uuid4().hex[:8]}",
            "timestamp": int(time.time()),
        }
        resp = httpx.post(
            f"http://127.0.0.1:{api_port}/api/webhook/whatsapp",
            json=body,
            headers={"X-API-Secret": bridge_api_secret},
            timeout=10.0,
        )
        assert resp.status_code == 202, resp.text

        msgs = poll_supabase(
            "messages",
            {"conversation_id": conv["id"]},
            predicate=lambda rows: any(
                (r.get("metadata") or {}).get("kind") == "fallback" for r in rows
            ),
            timeout=25.0,
            order_by="created_at",
        )
        fb = next(m for m in msgs if (m.get("metadata") or {}).get("kind") == "fallback")
        assert fb["content"].strip() == test_agent["fallback_message"].strip()

        sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
        assert any(m["message"].strip() == test_agent["fallback_message"].strip() for m in sent)
    finally:
        for proc in (worker_proc, api_proc):
            try:
                proc.terminate()
                proc.wait(timeout=6.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

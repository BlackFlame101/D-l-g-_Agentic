"""E2E: webhook auth — 401 on wrong secret, 503 when unset, 202 on non-text.

The ``api_server`` fixture starts uvicorn with a known secret. For the "unset"
case we spin a dedicated api server with ``WHATSAPP_BRIDGE_API_SECRET=""``.
"""

from __future__ import annotations

import os
import socket
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


def _pick_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _payload() -> dict:
    return {
        "userId": str(uuid.uuid4()),
        "senderPhone": "212600000000",
        "senderName": "Test",
        "senderJid": "212600000000@s.whatsapp.net",
        "messageContent": "hi",
        "messageType": "text",
        "messageId": "mid-test",
        "timestamp": int(time.time()),
    }


def test_wrong_secret_returns_401(api_server, bridge_api_secret):
    resp = httpx.post(
        f"{api_server}/api/webhook/whatsapp",
        json=_payload(),
        headers={"X-API-Secret": "definitely-not-the-right-secret"},
        timeout=10.0,
    )
    assert resp.status_code == 401, resp.text


def test_missing_secret_returns_401(api_server):
    resp = httpx.post(
        f"{api_server}/api/webhook/whatsapp",
        json=_payload(),
        timeout=10.0,
    )
    assert resp.status_code == 401, resp.text


def test_non_text_payload_returns_202(api_server, bridge_api_secret, mock_bridge):
    # Non-text messages are accepted + ignored by the worker. We only check
    # that the API accepts them.
    body = _payload()
    body["messageType"] = "image"
    body["messageContent"] = None
    resp = httpx.post(
        f"{api_server}/api/webhook/whatsapp",
        json=body,
        headers={"X-API-Secret": bridge_api_secret},
        timeout=10.0,
    )
    assert resp.status_code == 202, resp.text
    # Give the worker a moment; no bridge call should happen for this payload.
    time.sleep(1.5)
    assert all(m["message"] != body.get("messageContent") for m in mock_bridge.sent)


def test_secret_unset_returns_503(redis_url, mock_bridge, bridge_api_secret):
    """When the server has no bridge secret configured we surface a 503."""
    port = _pick_port()
    env = os.environ.copy()
    env["CELERY_BROKER_URL"] = redis_url
    env["CELERY_RESULT_BACKEND"] = redis_url
    env["WHATSAPP_BRIDGE_URL"] = mock_bridge.url
    env["WHATSAPP_BRIDGE_API_SECRET"] = ""
    env["TEST_LLM_MODE"] = "stub"
    env["TEST_EMBED_MODE"] = "stub"
    env["PYTHONPATH"] = str(BACKEND_ROOT) + os.pathsep + env.get("PYTHONPATH", "")

    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn", "main:app",
            "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning",
        ],
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait(f"http://127.0.0.1:{port}/health")
        resp = httpx.post(
            f"http://127.0.0.1:{port}/api/webhook/whatsapp",
            json=_payload(),
            headers={"X-API-Secret": bridge_api_secret},
            timeout=10.0,
        )
        assert resp.status_code == 503, resp.text
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

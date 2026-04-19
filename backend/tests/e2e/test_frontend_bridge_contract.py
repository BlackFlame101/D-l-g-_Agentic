"""E2E: frontend <-> whatsapp-bridge contract.

Spins the real Node bridge (via ``npm --prefix whatsapp-bridge start``) on a
random port, then makes the exact HTTP + WS calls the frontend makes:

* ``getWhatsAppQrWsUrl(userId)`` — open a WS on ``/api/session/<id>/qr``,
  authenticated via ``?apiSecret=...`` query param.
* ``getWhatsAppStatus(userId)`` — HTTP GET with ``X-API-Secret`` header.
* ``disconnectWhatsApp(userId)`` — HTTP POST with ``X-API-Secret`` header.

The test doesn't actually connect to WhatsApp; it only verifies the routes
exist, return 2xx, and emit at least one WS frame (``welcome`` / status /
``qr``) so the frontend's state machine can advance.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import pytest

pytestmark = [pytest.mark.e2e, pytest.mark.bridge]

REPO_ROOT = Path(__file__).resolve().parents[3]
BRIDGE_DIR = REPO_ROOT / "whatsapp-bridge"


def _pick_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_http(url: str, timeout: float = 45.0) -> None:
    start = time.monotonic()
    last = None
    while time.monotonic() - start < timeout:
        try:
            httpx.get(url, timeout=2.0)
            return
        except Exception as exc:
            last = exc
            time.sleep(0.4)
    raise TimeoutError(f"{url}: {last!r}")


@pytest.fixture(scope="module")
def node_bridge():
    if not BRIDGE_DIR.exists():
        pytest.skip(f"whatsapp-bridge directory missing: {BRIDGE_DIR}")
    node_modules = BRIDGE_DIR / "node_modules"
    if not node_modules.exists():
        pytest.skip(
            f"whatsapp-bridge/node_modules missing — run `npm install` in {BRIDGE_DIR}"
        )

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        pytest.skip("npm is not available on PATH")

    port = _pick_port()
    api_secret = f"bridge-{uuid.uuid4().hex[:10]}"

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["API_SECRET"] = api_secret
    env["BACKEND_URL"] = "http://127.0.0.1:9"  # unreachable, on purpose
    env["NODE_ENV"] = "development"
    # supabase/redis envs come from the normal process env; if missing the
    # bridge will bail early in validateConfig(). Pass them through.
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_ROLE_KEY"):
        pytest.skip(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set for the bridge to boot"
        )

    proc = subprocess.Popen(
        [npm, "--prefix", str(BRIDGE_DIR), "start"],
        env=env,
        stdout=subprocess.DEVNULL if not os.environ.get("E2E_VERBOSE") else None,
        stderr=subprocess.STDOUT if not os.environ.get("E2E_VERBOSE") else None,
        shell=sys.platform.startswith("win"),
    )

    try:
        _wait_http(f"http://127.0.0.1:{port}/health", timeout=60.0)
        yield {"port": port, "url": f"http://127.0.0.1:{port}", "api_secret": api_secret}
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def test_status_route_with_api_secret(node_bridge):
    user_id = str(uuid.uuid4())
    resp = httpx.get(
        f"{node_bridge['url']}/api/session/{user_id}/status",
        headers={"X-API-Secret": node_bridge["api_secret"]},
        timeout=10.0,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "status" in body
    assert "phone_number" in body  # frontend contract


def test_disconnect_route_with_api_secret(node_bridge):
    user_id = str(uuid.uuid4())
    resp = httpx.post(
        f"{node_bridge['url']}/api/session/{user_id}/disconnect",
        headers={"X-API-Secret": node_bridge["api_secret"]},
        timeout=10.0,
    )
    assert resp.status_code == 200, resp.text


def test_wrong_api_secret_is_rejected(node_bridge):
    user_id = str(uuid.uuid4())
    resp = httpx.get(
        f"{node_bridge['url']}/api/session/{user_id}/status",
        headers={"X-API-Secret": "not-the-right-secret"},
        timeout=10.0,
    )
    # In dev with NODE_ENV != production, the bridge lets missing/empty secrets
    # through, but an *incorrect* secret still returns 401.
    assert resp.status_code == 401, resp.text


def test_qr_websocket_accepts_browser_style_connection(node_bridge):
    """The frontend opens a plain WS on /api/session/:userId/qr."""
    try:
        import websockets  # type: ignore
    except ImportError:
        pytest.skip("websockets package is required for this test")

    ws_url = (
        f"ws://127.0.0.1:{node_bridge['port']}/api/session/{uuid.uuid4()}/qr"
        f"?apiSecret={node_bridge['api_secret']}"
    )

    async def _drive():
        async with websockets.connect(ws_url, open_timeout=10.0) as ws:
            # Expect at least one frame with a parsable JSON body within 5s.
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            data = json.loads(raw)
            assert isinstance(data, dict)
            # The first frame is usually session_status; accept any of the
            # normalized shapes.
            assert any(
                k in data for k in ("type", "status", "qr", "phone_number", "phoneNumber")
            ), data

    asyncio.run(_drive())


def test_qr_websocket_rejects_wrong_secret(node_bridge):
    try:
        import websockets  # type: ignore
    except ImportError:
        pytest.skip("websockets package is required for this test")

    ws_url = (
        f"ws://127.0.0.1:{node_bridge['port']}/api/session/{uuid.uuid4()}/qr"
        f"?apiSecret=WRONG"
    )

    async def _drive():
        with pytest.raises(Exception):
            async with websockets.connect(ws_url, open_timeout=5.0):
                pass

    asyncio.run(_drive())

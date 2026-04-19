"""Shared fixtures for the Delege end-to-end pytest harness.

Run these with::

    cd backend
    pytest tests/e2e -v --timeout=60

Required environment (see ``tests/README.md``):

* ``SUPABASE_URL`` / ``SUPABASE_SERVICE_ROLE_KEY`` / ``SUPABASE_ANON_KEY`` — from the
  Delege test project. **Not** the production one.
* A reachable Redis at ``REDIS_TEST_URL`` (defaults to ``redis://localhost:6379/15``).
* ``TEST_LLM_MODE=stub`` and ``TEST_EMBED_MODE=stub`` in the env for deterministic runs.

All "heavy" fixtures (api_server, celery_worker, mock_bridge) are session-scoped
and share one Supabase + Redis target. Per-test fixtures (``test_user``,
``test_agent``, ``test_subscription``, ``test_session``) tag rows with a
``TEST_PREFIX`` so orphan cleanup is safe if a test crashes.
"""

from __future__ import annotations

import contextlib
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TEST_PREFIX = os.environ.get("TEST_PREFIX", "pytest-e2e")
DEFAULT_TEST_REDIS_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379/15")
STARTUP_TIMEOUT_S = float(os.environ.get("E2E_STARTUP_TIMEOUT", "45"))

# Point the test process at the dedicated Redis DB *before* importing the
# settings module, so Celery's `.delay()` in the test process lines up with
# the subprocess worker. We unconditionally override so that a stray `.env`
# from dev cannot drag tests into DB 0 (which would silently cause
# worker-not-ready timeouts, or worse, mix test + dev payloads).
os.environ["CELERY_BROKER_URL"] = DEFAULT_TEST_REDIS_URL
os.environ["CELERY_RESULT_BACKEND"] = DEFAULT_TEST_REDIS_URL
os.environ["REDIS_URL"] = DEFAULT_TEST_REDIS_URL
os.environ.setdefault("TEST_LLM_MODE", "stub")
os.environ.setdefault("TEST_EMBED_MODE", "stub")

import httpx  # noqa: E402
import pytest  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, Header, HTTPException, Request  # noqa: E402

from core.config import settings  # noqa: E402
from services.supabase import get_admin_client  # noqa: E402


# ---------------------------------------------------------------------------
# Port / process helpers
# ---------------------------------------------------------------------------


def _pick_free_port() -> int:
    """Return a TCP port currently free on localhost (race-y but good enough)."""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_for_http(
    url: str,
    *,
    timeout: float = STARTUP_TIMEOUT_S,
    predicate: Optional[Callable[[httpx.Response], bool]] = None,
) -> None:
    """Block until ``url`` responds with 2xx (or the predicate is true)."""
    start = time.monotonic()
    last_err: Optional[Exception] = None
    while time.monotonic() - start < timeout:
        try:
            resp = httpx.get(url, timeout=2.0)
            if predicate:
                if predicate(resp):
                    return
            elif resp.status_code < 500:
                return
        except Exception as exc:
            last_err = exc
        time.sleep(0.4)
    raise TimeoutError(f"Gave up waiting for {url} after {timeout}s: {last_err!r}")


# ---------------------------------------------------------------------------
# Env / configuration guards
# ---------------------------------------------------------------------------


def _require_env() -> Dict[str, str]:
    """Collect the env vars required by every E2E fixture, skip otherwise."""
    required = {
        "SUPABASE_URL": settings.supabase_url,
        "SUPABASE_SERVICE_ROLE_KEY": settings.supabase_service_role_key,
        "SUPABASE_ANON_KEY": settings.supabase_anon_key,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        pytest.skip(
            f"E2E fixtures require env vars: {', '.join(missing)} (and a running Redis). "
            "See backend/tests/README.md."
        )
    return required


# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def redis_url() -> str:
    """Dedicated Redis DB for tests; flushed once per session."""
    _require_env()
    url = DEFAULT_TEST_REDIS_URL
    try:
        import redis  # type: ignore
    except ImportError:  # pragma: no cover - redis ships with celery
        pytest.skip("redis package not importable")
    try:
        client = redis.Redis.from_url(url, socket_timeout=2.0)
        client.ping()
        client.flushdb()
    except Exception as exc:
        pytest.skip(f"Redis not reachable at {url}: {exc}")
    return url


@pytest.fixture(autouse=True)
def _flush_redis_between_tests(request: pytest.FixtureRequest) -> Iterator[None]:
    """Flush the test Redis DB before each test that actually uses it."""
    if "redis_url" not in request.fixturenames:
        yield
        return
    import redis  # type: ignore

    url = request.getfixturevalue("redis_url")
    client = redis.Redis.from_url(url, socket_timeout=2.0)
    try:
        client.flushdb()
    except Exception:
        pass
    yield


# ---------------------------------------------------------------------------
# Mock bridge (FastAPI in-process)
# ---------------------------------------------------------------------------


class MockBridge:
    """Recording stand-in for the Node WhatsApp bridge.

    Accepts ``POST /api/session/{user_id}/send`` and stores each payload so
    tests can assert exactly what the backend sent to the bridge. Verifies the
    ``X-API-Secret`` header using the configured secret.
    """

    def __init__(self, host: str, port: int, api_secret: str) -> None:
        self.host = host
        self.port = port
        self.api_secret = api_secret
        self.sent: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self.app = self._build_app()
        self._server: Optional[uvicorn.Server] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def _build_app(self) -> FastAPI:
        app = FastAPI()

        @app.get("/")
        async def root():
            return {"status": "ok", "service": "mock-bridge"}

        @app.get("/health")
        async def health():
            return {"status": "healthy"}

        @app.post("/api/session/{user_id}/send")
        async def send(user_id: str, request: Request, x_api_secret: Optional[str] = Header(default=None, alias="X-API-Secret")):
            if x_api_secret != self.api_secret:
                raise HTTPException(status_code=401, detail="Invalid bridge secret")
            try:
                body = await request.json()
            except Exception:
                body = {}
            record = {
                "user_id": user_id,
                "to": body.get("to"),
                "message": body.get("message"),
                "received_at": time.time(),
            }
            with self._lock:
                self.sent.append(record)
            return {"success": True, "messageId": f"mock-{uuid.uuid4().hex[:8]}", "remaining": 1000}

        return app

    def start(self) -> None:
        cfg = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="warning",
            lifespan="on",
        )
        self._server = uvicorn.Server(cfg)

        def _run():
            self._server.run()

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()
        _wait_for_http(f"{self.url}/health")

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5.0)

    def clear(self) -> None:
        with self._lock:
            self.sent.clear()

    def messages_for(self, user_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return [m for m in self.sent if m["user_id"] == user_id]

    def wait_for(
        self,
        *,
        user_id: Optional[str] = None,
        count: int = 1,
        timeout: float = 15.0,
    ) -> List[Dict[str, Any]]:
        """Block until at least ``count`` messages arrive (optionally per-user)."""
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            with self._lock:
                if user_id is None:
                    pool = list(self.sent)
                else:
                    pool = [m for m in self.sent if m["user_id"] == user_id]
            if len(pool) >= count:
                return pool
            time.sleep(0.25)
        raise TimeoutError(
            f"Mock bridge didn't receive {count} message(s) within {timeout}s "
            f"(user_id={user_id!r}, got {len(pool)})"
        )


@pytest.fixture(scope="session")
def bridge_api_secret() -> str:
    return os.environ.get("E2E_BRIDGE_SECRET") or f"e2e-{secrets.token_hex(12)}"


@pytest.fixture(scope="session")
def mock_bridge(bridge_api_secret: str) -> Iterator[MockBridge]:
    _require_env()
    port = _pick_free_port()
    bridge = MockBridge("127.0.0.1", port, bridge_api_secret)
    bridge.start()
    try:
        yield bridge
    finally:
        bridge.stop()


@pytest.fixture(autouse=True)
def _reset_mock_bridge(request: pytest.FixtureRequest) -> Iterator[None]:
    """Clear mock bridge recorded messages between tests that use it."""
    if "mock_bridge" not in request.fixturenames:
        yield
        return
    bridge: MockBridge = request.getfixturevalue("mock_bridge")
    bridge.clear()
    yield


# ---------------------------------------------------------------------------
# FastAPI + Celery subprocesses
# ---------------------------------------------------------------------------


def _subprocess_env(
    *,
    redis_url: str,
    bridge_url: str,
    bridge_secret: str,
) -> Dict[str, str]:
    """Build the env dict passed to api/celery subprocesses.

    Copies the parent env (for PATH/SUPABASE creds/etc.), then overrides the
    Redis and bridge-specific variables so tests are isolated from dev state.
    """
    env = os.environ.copy()
    env["CELERY_BROKER_URL"] = redis_url
    env["CELERY_RESULT_BACKEND"] = redis_url
    env["REDIS_URL"] = redis_url
    env["WHATSAPP_BRIDGE_URL"] = bridge_url
    env["WHATSAPP_BRIDGE_API_SECRET"] = bridge_secret
    env["TEST_LLM_MODE"] = os.environ.get("TEST_LLM_MODE", "stub")
    env["TEST_EMBED_MODE"] = os.environ.get("TEST_EMBED_MODE", "stub")
    env.setdefault("DEBUG", "true")
    env.setdefault("LOG_LEVEL", "INFO")
    env["PYTHONPATH"] = str(BACKEND_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    return env


class BackgroundProcess:
    """Tiny wrapper around subprocess.Popen for tidy teardown."""

    def __init__(self, name: str, popen: subprocess.Popen) -> None:
        self.name = name
        self.popen = popen

    def terminate(self) -> None:
        if self.popen.poll() is not None:
            return
        try:
            self.popen.terminate()
            self.popen.wait(timeout=8.0)
        except subprocess.TimeoutExpired:
            self.popen.kill()
            with contextlib.suppress(Exception):
                self.popen.wait(timeout=3.0)


@pytest.fixture(scope="session")
def api_server(redis_url: str, mock_bridge: MockBridge, bridge_api_secret: str) -> Iterator[str]:
    """Run ``uvicorn main:app`` as a subprocess and return its base URL."""
    port = _pick_free_port()
    env = _subprocess_env(
        redis_url=redis_url,
        bridge_url=mock_bridge.url,
        bridge_secret=bridge_api_secret,
    )
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--log-level",
        "warning",
    ]
    popen = subprocess.Popen(
        cmd,
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.DEVNULL if not os.environ.get("E2E_VERBOSE") else None,
        stderr=subprocess.STDOUT if not os.environ.get("E2E_VERBOSE") else None,
    )
    proc = BackgroundProcess("api_server", popen)
    try:
        _wait_for_http(f"http://127.0.0.1:{port}/health")
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()


@pytest.fixture(scope="session")
def celery_worker(redis_url: str, mock_bridge: MockBridge, bridge_api_secret: str) -> Iterator[None]:
    """Run a solo-pool Celery worker and wait until it's reachable."""
    env = _subprocess_env(
        redis_url=redis_url,
        bridge_url=mock_bridge.url,
        bridge_secret=bridge_api_secret,
    )
    worker_name = f"pytest-{uuid.uuid4().hex[:8]}@%h"
    cmd = [
        sys.executable,
        "-m",
        "celery",
        "-A",
        "celery_app",
        "worker",
        "--loglevel=warning",
        "--pool=solo",
        "--concurrency=1",
        "-n",
        worker_name,
        "-Q",
        "celery",
        "--without-heartbeat",
        "--without-gossip",
        "--without-mingle",
    ]
    popen = subprocess.Popen(
        cmd,
        cwd=str(BACKEND_ROOT),
        env=env,
        stdout=subprocess.DEVNULL if not os.environ.get("E2E_VERBOSE") else None,
        stderr=subprocess.STDOUT if not os.environ.get("E2E_VERBOSE") else None,
    )
    proc = BackgroundProcess("celery_worker", popen)

    # Wait for the worker to respond to `ping` via the control channel.
    from celery import Celery

    probe = Celery("e2e-probe", broker=redis_url, backend=redis_url)
    start = time.monotonic()
    reached = False
    while time.monotonic() - start < STARTUP_TIMEOUT_S:
        try:
            pong = probe.control.ping(timeout=1.0)
            if pong:
                reached = True
                break
        except Exception:
            pass
        if popen.poll() is not None:
            raise RuntimeError("celery worker exited during startup")
        time.sleep(0.5)
    if not reached:
        proc.terminate()
        raise TimeoutError("Celery worker did not become ready within startup timeout")

    try:
        yield
    finally:
        proc.terminate()


# ---------------------------------------------------------------------------
# Supabase fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def supabase_admin():
    """Shared service-role client."""
    _require_env()
    return get_admin_client()


@pytest.fixture
def cleanup_registry() -> Iterator[Dict[str, List[str]]]:
    """Per-test deletion registry so fixtures can record IDs to remove."""
    registry: Dict[str, List[str]] = {
        "auth_users": [],
        "users": [],
        "agents": [],
        "subscriptions": [],
        "whatsapp_sessions": [],
        "knowledge_bases": [],
        "knowledge_chunks": [],
        "conversations": [],
    }
    yield registry
    admin = None
    try:
        admin = get_admin_client()
    except Exception:
        return

    def _hard_delete(table: str, ids: List[str]) -> None:
        if not ids:
            return
        try:
            admin.table(table).delete().in_("id", ids).execute()
        except Exception:
            pass

    # Order matters because of FKs
    for kb_id in registry.get("knowledge_bases", []):
        try:
            admin.table("knowledge_chunks").delete().eq("knowledge_base_id", kb_id).execute()
        except Exception:
            pass
    _hard_delete("knowledge_chunks", registry.get("knowledge_chunks", []))
    _hard_delete("knowledge_bases", registry.get("knowledge_bases", []))

    for conv_id in registry.get("conversations", []):
        try:
            admin.table("messages").delete().eq("conversation_id", conv_id).execute()
        except Exception:
            pass
    _hard_delete("conversations", registry.get("conversations", []))

    _hard_delete("whatsapp_sessions", registry.get("whatsapp_sessions", []))
    _hard_delete("subscriptions", registry.get("subscriptions", []))
    _hard_delete("agents", registry.get("agents", []))

    for user_id in registry.get("users", []):
        try:
            admin.table("usage_logs").delete().eq("user_id", user_id).execute()
        except Exception:
            pass
        try:
            admin.table("users").delete().eq("id", user_id).execute()
        except Exception:
            pass
    for user_id in registry.get("auth_users", []):
        try:
            admin.auth.admin.delete_user(user_id)
        except Exception:
            pass


def _ensure_profile(admin, user_id: str, *, full_name: str, phone: str, is_admin: bool = False) -> None:
    """Upsert a row in public.users so RLS-joined queries work."""
    try:
        admin.table("users").upsert(
            {
                "id": user_id,
                "full_name": full_name,
                "company_name": f"{TEST_PREFIX}-co-{uuid.uuid4().hex[:6]}",
                "phone": phone,
                "language_preference": "en",
                "is_admin": is_admin,
            }
        ).execute()
    except Exception:
        # Some projects have a trigger that auto-creates the row; in that case
        # do an update-only pass.
        try:
            admin.table("users").update(
                {
                    "full_name": full_name,
                    "phone": phone,
                    "language_preference": "en",
                    "is_admin": is_admin,
                }
            ).eq("id", user_id).execute()
        except Exception:
            pass


@pytest.fixture
def test_user(supabase_admin, cleanup_registry):
    """Create a Supabase auth user + public.users profile.

    Returns a dict: ``{"id", "email", "password", "profile"}``.
    """
    email = f"{TEST_PREFIX}+{uuid.uuid4().hex[:10]}@delege.test"
    password = f"Test-{secrets.token_urlsafe(24)}!Aa1"
    phone = f"+212600{uuid.uuid4().int % 1_000_000:06d}"

    try:
        created = supabase_admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"test_prefix": TEST_PREFIX},
            }
        )
    except Exception as exc:
        pytest.skip(f"Supabase admin.create_user failed: {exc}")

    user_obj = getattr(created, "user", None) or created
    user_id = str(getattr(user_obj, "id", None) or user_obj["id"])
    cleanup_registry["auth_users"].append(user_id)
    cleanup_registry["users"].append(user_id)

    _ensure_profile(
        supabase_admin,
        user_id,
        full_name=f"{TEST_PREFIX} user {user_id[:6]}",
        phone=phone,
    )

    return {
        "id": user_id,
        "email": email,
        "password": password,
        "phone": phone,
    }


@pytest.fixture
def admin_user(supabase_admin, cleanup_registry):
    """Like ``test_user`` but with ``is_admin=True`` so admin endpoints allow us."""
    email = f"{TEST_PREFIX}-admin+{uuid.uuid4().hex[:10]}@delege.test"
    password = f"Test-{secrets.token_urlsafe(24)}!Aa1"
    phone = f"+212611{uuid.uuid4().int % 1_000_000:06d}"

    try:
        created = supabase_admin.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"test_prefix": TEST_PREFIX, "role": "admin"},
            }
        )
    except Exception as exc:
        pytest.skip(f"Supabase admin.create_user failed: {exc}")

    user_obj = getattr(created, "user", None) or created
    user_id = str(getattr(user_obj, "id", None) or user_obj["id"])
    cleanup_registry["auth_users"].append(user_id)
    cleanup_registry["users"].append(user_id)

    _ensure_profile(
        supabase_admin,
        user_id,
        full_name=f"{TEST_PREFIX} admin {user_id[:6]}",
        phone=phone,
        is_admin=True,
    )

    return {
        "id": user_id,
        "email": email,
        "password": password,
        "phone": phone,
    }


@pytest.fixture
def supabase_jwt(supabase_admin):
    """Return a callable: ``(email, password) -> access_token``.

    Signs in via the anon key to produce a real Supabase JWT, exactly like the
    dashboard does.
    """
    from supabase import create_client

    def _sign_in(email: str, password: str) -> str:
        client = create_client(settings.supabase_url, settings.supabase_anon_key)
        resp = client.auth.sign_in_with_password({"email": email, "password": password})
        session = getattr(resp, "session", None)
        if session is None or not getattr(session, "access_token", None):
            raise RuntimeError("sign_in_with_password did not return a session")
        return str(session.access_token)

    return _sign_in


@pytest.fixture
def test_agent(supabase_admin, test_user, cleanup_registry):
    """Create an ``agents`` row owned by ``test_user`` and clean up after."""
    row = {
        "user_id": test_user["id"],
        "name": f"{TEST_PREFIX} Agent",
        "system_prompt": "You are a helpful test assistant for Delege QA.",
        "language": "en",
        "tone": "friendly",
        "greeting_message": "Hello from the Delege test agent!",
        "fallback_message": "Sorry, I'm having trouble right now.",
        "is_active": True,
    }
    resp = supabase_admin.table("agents").insert(row).execute()
    if not resp.data:
        raise RuntimeError("Failed to create test agent")
    agent = resp.data[0]
    cleanup_registry["agents"].append(agent["id"])
    return agent


@pytest.fixture
def test_plan(supabase_admin):
    """Find (or lazily create) a plan row suitable for assigning subscriptions."""
    existing = supabase_admin.table("plans").select("*").order("price_mad").limit(1).execute()
    if existing.data:
        return existing.data[0]
    plan = {
        "name": f"{TEST_PREFIX}-plan",
        "display_name": "Pytest Plan",
        "description": "Autogenerated by E2E tests",
        "price_mad": 0,
        "message_limit": 1000,
        "features": ["pytest"],
        "is_active": True,
    }
    resp = supabase_admin.table("plans").insert(plan).execute()
    if not resp.data:
        pytest.skip("Could not create or find any plan row")
    return resp.data[0]


@pytest.fixture
def test_subscription(supabase_admin, test_user, test_plan, cleanup_registry):
    """Active subscription with a generous limit and a far-future expiry."""
    now = datetime.now(timezone.utc)
    row = {
        "user_id": test_user["id"],
        "plan_id": test_plan["id"],
        "status": "active",
        "payment_method": "cash",
        "payment_reference": f"{TEST_PREFIX}-ref-{uuid.uuid4().hex[:8]}",
        "message_limit": 1000,
        "current_usage": 0,
        "activated_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
    }
    resp = supabase_admin.table("subscriptions").insert(row).execute()
    if not resp.data:
        raise RuntimeError("Failed to create test subscription")
    sub = resp.data[0]
    cleanup_registry["subscriptions"].append(sub["id"])
    return sub


@pytest.fixture
def test_session(supabase_admin, test_user, cleanup_registry):
    """Connected ``whatsapp_sessions`` row so bridge sends have a "connected" target."""
    digits = (test_user["phone"] or "").lstrip("+") or f"2126{uuid.uuid4().int % 10_000_000:08d}"
    row = {
        "user_id": test_user["id"],
        "phone_number": digits,
        "status": "connected",
        "session_data": {},
        "last_active_at": datetime.now(timezone.utc).isoformat(),
    }
    resp = supabase_admin.table("whatsapp_sessions").insert(row).execute()
    if not resp.data:
        raise RuntimeError("Failed to create test whatsapp_sessions row")
    session = resp.data[0]
    cleanup_registry["whatsapp_sessions"].append(session["id"])
    return session


# ---------------------------------------------------------------------------
# Helpers usable from tests
# ---------------------------------------------------------------------------


@pytest.fixture
def poll_supabase(supabase_admin):
    """Return a ``(table, filters, predicate) -> rows`` polling helper."""

    def _poll(
        table: str,
        filters: Dict[str, Any],
        predicate: Callable[[List[Dict[str, Any]]], bool],
        *,
        timeout: float = 15.0,
        interval: float = 0.4,
        select: str = "*",
        order_by: Optional[str] = None,
        order_desc: bool = False,
    ) -> List[Dict[str, Any]]:
        start = time.monotonic()
        last: List[Dict[str, Any]] = []
        while time.monotonic() - start < timeout:
            query = supabase_admin.table(table).select(select)
            for col, val in filters.items():
                query = query.eq(col, val)
            if order_by:
                query = query.order(order_by, desc=order_desc)
            try:
                resp = query.execute()
                last = list(resp.data or [])
                if predicate(last):
                    return last
            except Exception:
                pass
            time.sleep(interval)
        raise AssertionError(
            f"poll_supabase timed out on {table} filters={filters} last_rows={last!r}"
        )

    return _poll


@pytest.fixture
def bridge_webhook(api_server: str, bridge_api_secret: str):
    """Return a ``post_message(**payload)`` helper for the bridge webhook."""

    def _post(
        *,
        user_id: str,
        sender_phone: str,
        message_content: str,
        sender_name: Optional[str] = "Test User",
        message_type: str = "text",
        message_id: Optional[str] = None,
        sender_jid: Optional[str] = None,
        secret: Optional[str] = None,
    ) -> httpx.Response:
        digits = sender_phone.lstrip("+")
        jid = sender_jid or f"{digits}@s.whatsapp.net"
        body = {
            "userId": user_id,
            "senderPhone": digits,
            "senderName": sender_name,
            "senderJid": jid,
            "messageContent": message_content,
            "messageType": message_type,
            "messageId": message_id or f"mid-{uuid.uuid4().hex[:8]}",
            "timestamp": int(time.time()),
        }
        headers = {"X-API-Secret": secret if secret is not None else bridge_api_secret}
        return httpx.post(f"{api_server}/api/webhook/whatsapp", json=body, headers=headers, timeout=10.0)

    return _post


@pytest.fixture
def authed_client(api_server: str):
    """Return a factory that builds an ``httpx.Client`` with a Bearer token."""

    def _factory(access_token: str) -> httpx.Client:
        return httpx.Client(
            base_url=api_server,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=15.0,
        )

    return _factory

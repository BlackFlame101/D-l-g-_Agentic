"""Interactive smoke tests for Delege.

Reuses the fixtures in ``tests/conftest.py`` (mock bridge, subprocesses, stub
LLM / embeddings) to let you hit the full stack from a single command without
pytest collection. Useful before deployments (Phase 8.12) or when iterating on
a single scenario.

Typical invocations::

    python scripts/smoke_all.py --help
    python scripts/smoke_all.py --scenario inbound
    python scripts/smoke_all.py --scenario rag
    python scripts/smoke_all.py --scenario expiry-warning --language fr

Pass ``--real-llm`` / ``--real-embeddings`` to bypass the stub knobs; useful
for sanity-checking that your Gemini credentials still work. The harness will
still hit the *mock* WhatsApp bridge so no real messages go out unless you
additionally set ``--real-bridge``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(BACKEND_ROOT / "tests"))


def _banner(msg: str) -> None:
    print(f"\n=== {msg} ===", flush=True)


def _setup_env(args: argparse.Namespace) -> None:
    if not args.real_llm:
        os.environ.setdefault("TEST_LLM_MODE", "stub")
    if not args.real_embeddings:
        os.environ.setdefault("TEST_EMBED_MODE", "stub")
    os.environ.setdefault("REDIS_TEST_URL", args.redis_url)
    os.environ.setdefault("CELERY_BROKER_URL", args.redis_url)
    os.environ.setdefault("CELERY_RESULT_BACKEND", args.redis_url)


def scenario_inbound(helpers, args) -> None:
    """Send a webhook and assert the greeting reaches the (mock) bridge."""
    user = helpers.make_test_user()
    agent = helpers.make_test_agent(user["id"])
    helpers.make_test_subscription(user["id"])
    helpers.make_test_session(user["id"], user["phone"])

    contact = f"2126{uuid.uuid4().int % 10_000_000:08d}"
    _banner(f"POST /api/webhook/whatsapp for user={user['id']} contact={contact}")
    helpers.post_webhook(user_id=user["id"], sender_phone=contact, message="Hello!")

    _banner("Waiting for mock bridge reply...")
    sent = helpers.wait_bridge(user["id"], count=1, timeout=20.0)
    for m in sent:
        print(f"  -> {m['message']!r} to {m['to']!r}")


def scenario_rag(helpers, args) -> None:
    """Seed a knowledge chunk, POST a webhook, see the stub/agent reply."""
    from services.gemini import _stub_embedding

    user = helpers.make_test_user()
    agent = helpers.make_test_agent(user["id"])
    helpers.make_test_subscription(user["id"])
    helpers.make_test_session(user["id"], user["phone"])

    contact = f"2127{uuid.uuid4().int % 10_000_000:08d}"
    # Skip greeting by pre-creating the conversation
    conv = helpers.admin.table("conversations").insert(
        {
            "agent_id": agent["id"],
            "contact_phone": contact,
            "status": "active",
            "message_count": 1,
        }
    ).execute().data[0]
    helpers.admin.table("messages").insert(
        {"conversation_id": conv["id"], "role": "assistant", "content": "Hi"}
    ).execute()

    text = "Our opening hours are Monday to Friday 9am to 6pm."
    kb = helpers.admin.table("knowledge_bases").insert(
        {
            "agent_id": agent["id"],
            "file_name": "hours.txt",
            "file_url": f"{user['id']}/{agent['id']}/hours.txt",
            "file_type": "txt",
            "status": "ready",
            "chunk_count": 1,
        }
    ).execute().data[0]
    helpers.admin.table("knowledge_chunks").insert(
        {
            "knowledge_base_id": kb["id"],
            "content": text,
            "embedding": _stub_embedding(text),
            "chunk_index": 0,
            "metadata": {},
        }
    ).execute()

    _banner("POST webhook with a RAG-matching question")
    helpers.post_webhook(user_id=user["id"], sender_phone=contact, message="What are your hours?")

    sent = helpers.wait_bridge(user["id"], count=1, timeout=25.0)
    for m in sent:
        print(f"  -> {m['message']!r}")


def scenario_expiry_warning(helpers, args) -> None:
    """Schedule an expiry warning and verify the templated notice goes out."""
    user = helpers.make_test_user(language=args.language)
    agent = helpers.make_test_agent(user["id"])
    helpers.make_test_session(user["id"], user["phone"])
    sub = helpers.make_test_subscription(
        user["id"],
        expires_in_days=3,
    )

    from services.tasks import send_expiry_warnings

    _banner("Running send_expiry_warnings.apply()")
    result = send_expiry_warnings.apply(kwargs={"days_before": 3}).get()
    print("  task result:", result)

    sent = helpers.wait_bridge(user["id"], count=1, timeout=30.0)
    for m in sent:
        print(f"  -> {m['message']!r} to {m['to']!r}")


def scenario_expiry_deactivation(helpers, args) -> None:
    """Expire a subscription, then assert the agent is paused."""
    user = helpers.make_test_user()
    agent = helpers.make_test_agent(user["id"])
    sub = helpers.make_test_subscription(
        user["id"],
        expires_in_days=-1,  # already expired
    )

    from services.tasks import check_subscription_expiry

    _banner("Running check_subscription_expiry.apply()")
    result = check_subscription_expiry.apply().get()
    print("  task result:", result)

    row = helpers.admin.table("agents").select("is_active").eq("id", agent["id"]).limit(1).execute()
    print("  agent.is_active =", row.data[0]["is_active"] if row.data else None)


SCENARIOS = {
    "inbound": scenario_inbound,
    "rag": scenario_rag,
    "expiry-warning": scenario_expiry_warning,
    "expiry-deactivation": scenario_expiry_deactivation,
}


def _build_helpers(args: argparse.Namespace):
    """Stand up a tiny harness the scenarios can poke at."""
    import secrets
    import socket
    import subprocess
    import threading
    import contextlib
    from datetime import datetime, timedelta, timezone

    import httpx
    import uvicorn
    from fastapi import FastAPI, Header, HTTPException, Request

    from core.config import settings as _settings  # noqa: F401 - force load
    from services.supabase import get_admin_client

    admin = get_admin_client()

    # --- Mock bridge ---------------------------------------------------------
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        bridge_port = s.getsockname()[1]

    bridge_secret = f"smoke-{secrets.token_hex(6)}"
    sent: list[dict] = []
    lock = threading.Lock()

    app = FastAPI()

    @app.post("/api/session/{user_id}/send")
    async def send(user_id: str, request: Request, x_api_secret: str = Header(default=None, alias="X-API-Secret")):
        if x_api_secret != bridge_secret:
            raise HTTPException(status_code=401)
        body = await request.json()
        with lock:
            sent.append({"user_id": user_id, "to": body.get("to"), "message": body.get("message")})
        return {"success": True, "messageId": f"mock-{uuid.uuid4().hex[:6]}"}

    @app.get("/health")
    async def health():
        return {"ok": True}

    bridge_cfg = uvicorn.Config(app, host="127.0.0.1", port=bridge_port, log_level="warning")
    bridge_server = uvicorn.Server(bridge_cfg)
    threading.Thread(target=bridge_server.run, daemon=True).start()
    for _ in range(100):
        try:
            httpx.get(f"http://127.0.0.1:{bridge_port}/health", timeout=1.0)
            break
        except Exception:
            time.sleep(0.2)

    bridge_url = f"http://127.0.0.1:{bridge_port}"
    if args.real_bridge:
        bridge_url = os.environ.get("WHATSAPP_BRIDGE_URL", "http://localhost:3001")
        bridge_secret = os.environ.get("WHATSAPP_BRIDGE_API_SECRET", bridge_secret)

    # --- API + Celery subprocesses ------------------------------------------
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        api_port = s.getsockname()[1]

    env = os.environ.copy()
    env["CELERY_BROKER_URL"] = args.redis_url
    env["CELERY_RESULT_BACKEND"] = args.redis_url
    env["REDIS_URL"] = args.redis_url
    env["WHATSAPP_BRIDGE_URL"] = bridge_url
    env["WHATSAPP_BRIDGE_API_SECRET"] = bridge_secret
    env["PYTHONPATH"] = str(BACKEND_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    if "TEST_LLM_MODE" in os.environ:
        env["TEST_LLM_MODE"] = os.environ["TEST_LLM_MODE"]
    if "TEST_EMBED_MODE" in os.environ:
        env["TEST_EMBED_MODE"] = os.environ["TEST_EMBED_MODE"]

    api_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(api_port), "--log-level", "warning"],
        cwd=str(BACKEND_ROOT),
        env=env,
    )
    worker_proc = subprocess.Popen(
        [
            sys.executable, "-m", "celery", "-A", "celery_app", "worker",
            "--loglevel=warning", "--pool=solo", "--concurrency=1",
            "-n", f"smoke-{uuid.uuid4().hex[:6]}@%h",
            "-Q", "celery",
            "--without-heartbeat", "--without-gossip", "--without-mingle",
        ],
        cwd=str(BACKEND_ROOT),
        env=env,
    )
    for _ in range(150):
        try:
            httpx.get(f"http://127.0.0.1:{api_port}/health", timeout=1.0)
            break
        except Exception:
            time.sleep(0.3)

    created: dict[str, list[str]] = {"users": [], "agents": [], "subs": [], "sessions": [], "kbs": []}

    def _post_webhook(*, user_id: str, sender_phone: str, message: str):
        digits = sender_phone.lstrip("+")
        body = {
            "userId": user_id,
            "senderPhone": digits,
            "senderName": "Smoke",
            "senderJid": f"{digits}@s.whatsapp.net",
            "messageContent": message,
            "messageType": "text",
            "messageId": f"mid-{uuid.uuid4().hex[:6]}",
            "timestamp": int(time.time()),
        }
        return httpx.post(
            f"http://127.0.0.1:{api_port}/api/webhook/whatsapp",
            json=body,
            headers={"X-API-Secret": bridge_secret},
            timeout=10.0,
        )

    def _make_user(*, language: str = "en"):
        email = f"smoke+{uuid.uuid4().hex[:10]}@delege.test"
        password = f"Smoke-{secrets.token_urlsafe(20)}!Aa1"
        phone = f"+212600{uuid.uuid4().int % 1_000_000:06d}"
        created_user = admin.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        )
        uid = str(getattr(created_user, "user", None).id if hasattr(created_user, "user") else created_user["user"]["id"])
        admin.table("users").upsert(
            {"id": uid, "full_name": "Smoke User", "phone": phone, "language_preference": language}
        ).execute()
        created["users"].append(uid)
        return {"id": uid, "email": email, "password": password, "phone": phone}

    def _make_agent(user_id: str):
        row = admin.table("agents").insert(
            {
                "user_id": user_id,
                "name": "Smoke Agent",
                "system_prompt": "You are a smoke-test assistant.",
                "language": "en",
                "tone": "friendly",
                "greeting_message": "Hi from smoke!",
                "fallback_message": "Sorry, having trouble.",
                "is_active": True,
            }
        ).execute().data[0]
        created["agents"].append(row["id"])
        return row

    def _make_sub(user_id: str, expires_in_days: int = 30):
        plan = admin.table("plans").select("*").order("price_mad").limit(1).execute().data[0]
        now = datetime.now(timezone.utc)
        row = admin.table("subscriptions").insert(
            {
                "user_id": user_id,
                "plan_id": plan["id"],
                "status": "active",
                "payment_method": "cash",
                "message_limit": 1000,
                "current_usage": 0,
                "activated_at": now.isoformat(),
                "expires_at": (now + timedelta(days=expires_in_days)).isoformat(),
            }
        ).execute().data[0]
        created["subs"].append(row["id"])
        return row

    def _make_session(user_id: str, phone: str):
        digits = (phone or "").lstrip("+") or f"2126{uuid.uuid4().int % 10_000_000:08d}"
        row = admin.table("whatsapp_sessions").insert(
            {
                "user_id": user_id,
                "phone_number": digits,
                "status": "connected",
                "session_data": {},
                "last_active_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute().data[0]
        created["sessions"].append(row["id"])
        return row

    def _wait_bridge(user_id: str, *, count: int, timeout: float):
        start = time.monotonic()
        while time.monotonic() - start < timeout:
            with lock:
                pool = [m for m in sent if m["user_id"] == user_id]
            if len(pool) >= count:
                return pool
            time.sleep(0.3)
        raise TimeoutError(f"Bridge saw {len(pool)} for {user_id}, expected {count}")

    def _shutdown():
        for proc in (worker_proc, api_proc):
            try:
                proc.terminate()
                proc.wait(timeout=6.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        bridge_server.should_exit = True

        if args.no_cleanup:
            return
        for sub_id in created["subs"]:
            admin.table("subscriptions").delete().eq("id", sub_id).execute()
        for sess_id in created["sessions"]:
            admin.table("whatsapp_sessions").delete().eq("id", sess_id).execute()
        for agent_id in created["agents"]:
            admin.table("agents").delete().eq("id", agent_id).execute()
        for uid in created["users"]:
            try:
                admin.table("users").delete().eq("id", uid).execute()
            except Exception:
                pass
            try:
                admin.auth.admin.delete_user(uid)
            except Exception:
                pass

    class Helpers:
        pass

    h = Helpers()
    h.admin = admin
    h.post_webhook = _post_webhook
    h.make_test_user = _make_user
    h.make_test_agent = _make_agent
    h.make_test_subscription = _make_sub
    h.make_test_session = _make_session
    h.wait_bridge = _wait_bridge
    h.shutdown = _shutdown
    h.api_url = f"http://127.0.0.1:{api_port}"
    h.bridge_url = bridge_url
    return h


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="inbound")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_TEST_URL", "redis://localhost:6379/15"))
    parser.add_argument("--language", default="fr")
    parser.add_argument("--real-llm", action="store_true", help="Bypass TEST_LLM_MODE=stub")
    parser.add_argument("--real-embeddings", action="store_true", help="Bypass TEST_EMBED_MODE=stub")
    parser.add_argument("--real-bridge", action="store_true", help="Talk to the running Node bridge instead of the in-process mock")
    parser.add_argument("--no-cleanup", action="store_true", help="Keep created Supabase rows around (debugging)")
    args = parser.parse_args()

    _setup_env(args)
    helpers = _build_helpers(args)
    try:
        SCENARIOS[args.scenario](helpers, args)
    finally:
        helpers.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

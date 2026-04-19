"""Celery tasks that do the heavy lifting behind the FastAPI endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from celery_app import celery_app
from core.config import settings
from core.logging import get_logger
from schemas.webhook import WhatsAppWebhookPayload
from services.agent_factory import generate_reply
from services.bridge import BridgeError, send_whatsapp_reply
from services.conversations import (
    get_active_agent_for_user,
    get_or_create_conversation,
    insert_message,
    load_history,
    touch_session,
)
from services.documents import (
    chunk_text,
    extract_text,
    iter_batches,
)
from services.gemini import approximate_token_count, embed_documents
from services.rag import retrieve_context
from services.storage import download_file
from services.supabase import get_admin_client
from services.usage import check_subscription_limit, increment_usage

logger = get_logger(__name__)


LIMIT_REACHED_NOTICE = {
    "no_subscription": (
        "This business doesn't have an active subscription yet. "
        "Please contact the business owner."
    ),
    "inactive": (
        "This AI assistant is currently paused. The business owner will be in touch soon."
    ),
    "expired": (
        "This business's subscription has expired. They'll be back online shortly."
    ),
    "limit_reached": (
        "This business has reached its monthly message limit. "
        "Please try again next month or contact the owner."
    ),
}


@celery_app.task(bind=True, max_retries=3, name="services.tasks.process_whatsapp_message")
def process_whatsapp_message(self, message_data: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a single inbound WhatsApp message end-to-end.

    Pipeline:

    1. Parse/validate payload and resolve the user's active agent.
    2. Enforce subscription limits (send a one-time notice if blocked).
    3. Create or fetch the conversation; send greeting on first contact.
    4. Persist the user message; retrieve RAG chunks; load short history.
    5. Generate a reply with Agno + Gemini (falling back to a canned message).
    6. Persist the assistant message, increment usage, deliver via the bridge.
    """
    try:
        payload = WhatsAppWebhookPayload.model_validate(message_data)
    except Exception as exc:
        logger.error("Invalid webhook payload", extra={"error": str(exc)})
        return {"status": "invalid_payload"}

    log_ctx = {
        "user_id": payload.user_id,
        "sender_phone": payload.sender_phone,
        "message_id": payload.message_id,
    }

    if payload.message_type != "text" or not (payload.message_content or "").strip():
        logger.info("Ignoring non-text message in worker", extra=log_ctx)
        return {"status": "ignored_non_text"}

    touch_session(payload.user_id)

    agent_row = get_active_agent_for_user(payload.user_id)
    if agent_row is None:
        logger.warning("No active agent configured for user", extra=log_ctx)
        return {"status": "no_agent"}

    limit = check_subscription_limit(payload.user_id)
    if not limit.allowed:
        logger.info(
            "Subscription blocked; sending notice",
            extra={**log_ctx, "reason": limit.reason},
        )
        _send_limit_notice(payload, limit.reason or "inactive")
        return {"status": "blocked", "reason": limit.reason}

    conversation, is_new = get_or_create_conversation(
        agent_id=agent_row["id"],
        contact_phone=payload.sender_phone,
        contact_name=payload.sender_name,
    )

    user_message_text = payload.message_content.strip()
    insert_message(
        conversation_id=conversation["id"],
        role="user",
        content=user_message_text,
        tokens_used=approximate_token_count(user_message_text),
        metadata={
            "whatsapp_message_id": payload.message_id,
            "timestamp": payload.timestamp,
        },
    )

    if is_new and (agent_row.get("greeting_message") or "").strip():
        greeting = agent_row["greeting_message"].strip()
        insert_message(
            conversation_id=conversation["id"],
            role="assistant",
            content=greeting,
            tokens_used=approximate_token_count(greeting),
            metadata={"kind": "greeting"},
        )
        try:
            increment_usage(payload.user_id, messages=1, tokens=approximate_token_count(greeting))
            send_whatsapp_reply(payload.user_id, payload.sender_jid, greeting)
        except BridgeError as exc:
            logger.error("Bridge failed while sending greeting", extra={**log_ctx, "error": str(exc)})
            raise self.retry(exc=exc, countdown=5)
        return {"status": "greeting_sent", "conversation_id": conversation["id"]}

    chunks = retrieve_context(agent_id=agent_row["id"], query=user_message_text)
    history = load_history(
        conversation_id=conversation["id"],
        limit=settings.conversation_history_limit,
    )
    if history and history[-1].role == "user" and history[-1].content == user_message_text:
        history = history[:-1]

    reply = generate_reply(
        agent_row=agent_row,
        user_message=user_message_text,
        chunks=chunks,
        history=history,
    )

    insert_message(
        conversation_id=conversation["id"],
        role="assistant",
        content=reply.content,
        tokens_used=reply.tokens_used,
        metadata={
            "kind": "fallback" if reply.used_fallback else "agent",
            "input_tokens": reply.input_tokens,
            "output_tokens": reply.output_tokens,
            "retrieved_chunks": [c.to_log_dict() for c in chunks],
        },
    )

    increment_usage(payload.user_id, messages=1, tokens=reply.tokens_used)

    try:
        send_whatsapp_reply(payload.user_id, payload.sender_jid, reply.content)
    except BridgeError as exc:
        logger.error("Bridge send failed", extra={**log_ctx, "error": str(exc)})
        raise self.retry(exc=exc, countdown=5)

    logger.info(
        "Reply delivered",
        extra={
            **log_ctx,
            "conversation_id": conversation["id"],
            "tokens_used": reply.tokens_used,
            "used_fallback": reply.used_fallback,
            "rag_chunks": len(chunks),
        },
    )
    return {
        "status": "delivered",
        "conversation_id": conversation["id"],
        "tokens_used": reply.tokens_used,
        "used_fallback": reply.used_fallback,
    }


def _send_limit_notice(payload: WhatsAppWebhookPayload, reason: str) -> None:
    """Send a best-effort WhatsApp notice when the user is over their plan."""
    text = LIMIT_REACHED_NOTICE.get(reason, LIMIT_REACHED_NOTICE["inactive"])
    try:
        send_whatsapp_reply(payload.user_id, payload.sender_jid, text)
    except BridgeError as exc:  # pragma: no cover - best effort
        logger.warning(
            "Could not send limit notice",
            extra={"user_id": payload.user_id, "error": str(exc)},
        )


# ---------------------------------------------------------------------------
# Knowledge base indexing
# ---------------------------------------------------------------------------


@celery_app.task(bind=True, max_retries=2, name="services.tasks.index_knowledge_file")
def index_knowledge_file(self, kb_id: str) -> Dict[str, Any]:
    """Download, extract, chunk, embed and index a knowledge-base file."""
    admin = get_admin_client()

    kb_resp = admin.table("knowledge_bases").select("*").eq("id", kb_id).limit(1).execute()
    if not kb_resp.data:
        logger.error("Knowledge base row not found", extra={"kb_id": kb_id})
        return {"status": "not_found"}
    kb = kb_resp.data[0]

    storage_path = (kb.get("file_url") or "").strip()
    if not storage_path:
        _mark_kb_failed(kb_id, "Missing storage path")
        return {"status": "missing_path"}

    admin.table("knowledge_bases").update(
        {"status": "processing", "error_message": None, "updated_at": _now_iso()}
    ).eq("id", kb_id).execute()

    try:
        file_bytes = download_file(storage_path)
        text = extract_text(
            file_bytes,
            file_type=kb.get("file_type"),
            file_name=kb.get("file_name"),
        )
        if not text.strip():
            _mark_kb_failed(kb_id, "File contained no extractable text")
            return {"status": "empty"}

        chunks = chunk_text(text)
        if not chunks:
            _mark_kb_failed(kb_id, "Chunking produced no segments")
            return {"status": "empty"}

        admin.table("knowledge_chunks").delete().eq("knowledge_base_id", kb_id).execute()

        total_chunks = 0
        chunk_index_offset = 0
        for batch in iter_batches(chunks, settings.knowledge_embed_batch_size):
            embeddings = embed_documents(batch)
            if len(embeddings) != len(batch):
                raise RuntimeError(
                    f"Embedding count {len(embeddings)} != batch size {len(batch)}"
                )
            rows = [
                {
                    "knowledge_base_id": kb_id,
                    "content": content,
                    "embedding": embedding,
                    "chunk_index": chunk_index_offset + i,
                    "metadata": {
                        "file_name": kb.get("file_name"),
                        "file_type": kb.get("file_type"),
                    },
                }
                for i, (content, embedding) in enumerate(zip(batch, embeddings))
            ]
            admin.table("knowledge_chunks").insert(rows).execute()
            total_chunks += len(rows)
            chunk_index_offset += len(rows)

        admin.table("knowledge_bases").update(
            {
                "status": "ready",
                "chunk_count": total_chunks,
                "error_message": None,
                "updated_at": _now_iso(),
            }
        ).eq("id", kb_id).execute()

        logger.info(
            "Indexed knowledge file",
            extra={"kb_id": kb_id, "chunks": total_chunks, "file_name": kb.get("file_name")},
        )
        return {"status": "indexed", "chunks": total_chunks}

    except Exception as exc:
        logger.exception("Indexing failed", extra={"kb_id": kb_id, "error": str(exc)})
        try:
            raise self.retry(exc=exc, countdown=10)
        except self.MaxRetriesExceededError:
            _mark_kb_failed(kb_id, str(exc))
            return {"status": "failed", "error": str(exc)}


def _mark_kb_failed(kb_id: str, message: str) -> None:
    try:
        get_admin_client().table("knowledge_bases").update(
            {"status": "failed", "error_message": message[:500], "updated_at": _now_iso()}
        ).eq("id", kb_id).execute()
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to mark KB failed", extra={"kb_id": kb_id, "error": str(exc)})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Subscription lifecycle (daily Celery beat jobs)
# ---------------------------------------------------------------------------


EXPIRY_WARNING_TEMPLATES: Dict[str, str] = {
    "fr": (
        "Bonjour {name}, votre abonnement Delege expire dans {days} jour(s) "
        "({date}). Pensez à le renouveler pour que votre agent IA continue "
        "à répondre à vos clients sans interruption."
    ),
    "ar": (
        "مرحبا {name}، سينتهي اشتراكك في Delege خلال {days} يوم/أيام ({date}). "
        "يرجى تجديده لكي يواصل الوكيل الذكي الرد على عملائك دون انقطاع."
    ),
    "en": (
        "Hi {name}, your Delege subscription expires in {days} day(s) "
        "({date}). Renew now so your AI agent keeps responding to your "
        "customers without interruption."
    ),
}


def _phone_to_jid(phone: str) -> str:
    """Normalize a phone number into a Baileys-compatible WhatsApp JID."""
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        raise ValueError("Empty phone number")
    return f"{digits}@s.whatsapp.net"


@celery_app.task(name="services.tasks.check_subscription_expiry")
def check_subscription_expiry() -> Dict[str, Any]:
    """Mark active subscriptions whose ``expires_at`` has passed as ``expired``.

    Also pauses any agents owned by those users so the worker stops replying
    on their behalf. Designed to run daily via Celery beat.
    """
    admin = get_admin_client()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    resp = (
        admin.table("subscriptions")
        .select("id,user_id,expires_at")
        .eq("status", "active")
        .is_("deleted_at", "null")
        .lt("expires_at", now_iso)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        logger.info("No subscriptions to expire")
        return {"expired": 0}

    sub_ids = [r["id"] for r in rows]
    user_ids: List[str] = list({str(r["user_id"]) for r in rows if r.get("user_id")})

    admin.table("subscriptions").update(
        {"status": "expired", "updated_at": now_iso}
    ).in_("id", sub_ids).execute()

    if user_ids:
        try:
            admin.table("agents").update(
                {"is_active": False, "updated_at": now_iso}
            ).in_("user_id", user_ids).is_("deleted_at", "null").execute()
        except Exception as exc:  # pragma: no cover - non-fatal
            logger.warning("Could not deactivate agents", extra={"error": str(exc)})

    logger.info(
        "Subscriptions expired",
        extra={"count": len(rows), "users": len(user_ids)},
    )
    return {"expired": len(rows), "users": len(user_ids)}


@celery_app.task(name="services.tasks.send_expiry_warnings")
def send_expiry_warnings(days_before: int = 3) -> Dict[str, Any]:
    """Find active subscriptions expiring in ~``days_before`` days and notify.

    A 24h window is used so the job is forgiving of beat clock drift.
    """
    admin = get_admin_client()
    now = datetime.now(timezone.utc)
    target_start = now + timedelta(days=days_before)
    target_end = target_start + timedelta(hours=24)

    resp = (
        admin.table("subscriptions")
        .select("id,user_id,expires_at")
        .eq("status", "active")
        .is_("deleted_at", "null")
        .gte("expires_at", target_start.isoformat())
        .lt("expires_at", target_end.isoformat())
        .execute()
    )
    rows = resp.data or []
    queued = 0
    for row in rows:
        user_id = row.get("user_id")
        if not user_id:
            continue
        notify_user_expiry.delay(str(user_id), days_before)
        queued += 1

    logger.info("Queued expiry warnings", extra={"count": queued})
    return {"queued": queued}


@celery_app.task(
    bind=True,
    max_retries=2,
    name="services.tasks.notify_user_expiry",
)
def notify_user_expiry(self, user_id: str, days_left: int) -> Dict[str, Any]:
    """Send a localized "your sub expires soon" message to ``user_id``."""
    admin = get_admin_client()

    profile_resp = (
        admin.table("users")
        .select("full_name,language_preference")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not profile_resp.data:
        return {"status": "no_profile"}
    profile = profile_resp.data[0]
    lang = (profile.get("language_preference") or "fr").lower()
    template = EXPIRY_WARNING_TEMPLATES.get(lang, EXPIRY_WARNING_TEMPLATES["fr"])
    name = profile.get("full_name") or ""

    sub_resp = (
        admin.table("subscriptions")
        .select("expires_at")
        .eq("user_id", user_id)
        .eq("status", "active")
        .is_("deleted_at", "null")
        .order("expires_at", desc=False)
        .limit(1)
        .execute()
    )
    expires_at = (sub_resp.data or [{}])[0].get("expires_at")
    expires_str = "—"
    if expires_at:
        try:
            dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            expires_str = dt.date().isoformat()
        except ValueError:
            pass

    session_resp = (
        admin.table("whatsapp_sessions")
        .select("phone_number,status")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    session = (session_resp.data or [{}])[0]
    phone = session.get("phone_number")
    if not phone or session.get("status") != "connected":
        logger.info(
            "Skipping expiry notice; no connected session",
            extra={"user_id": user_id, "status": session.get("status")},
        )
        return {"status": "skipped_no_session"}

    try:
        jid = _phone_to_jid(phone)
    except ValueError:
        return {"status": "invalid_phone"}

    message = template.format(
        name=name.strip() or "",
        days=days_left,
        date=expires_str,
    )

    try:
        send_whatsapp_reply(user_id, jid, message)
    except BridgeError as exc:
        logger.warning(
            "Could not deliver expiry notice",
            extra={"user_id": user_id, "error": str(exc)},
        )
        try:
            raise self.retry(exc=exc, countdown=60 * 30)
        except self.MaxRetriesExceededError:
            return {"status": "bridge_failed", "error": str(exc)}

    return {"status": "sent"}

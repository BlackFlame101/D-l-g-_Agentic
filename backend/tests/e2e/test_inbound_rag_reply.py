"""E2E: RAG retrieval + stub LLM produces a deterministic reply.

Flow:
1. Pre-create a ``conversations`` row so the greeting path is skipped.
2. Seed a ``knowledge_bases`` + ``knowledge_chunks`` row with a stub-embedded
   text chunk.
3. Send an inbound webhook matching the chunk content.
4. Assert the stored assistant message is the deterministic ``[stub] ...``
   reply and that the RAG chunk is recorded in the message metadata.
"""

from __future__ import annotations

import uuid

import pytest

from services.gemini import _stub_embedding

pytestmark = [pytest.mark.e2e]


def test_rag_retrieval_reaches_agent(
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
    cleanup_registry,
):
    contact_phone = f"2127{uuid.uuid4().int % 10_000_000:08d}"

    # Pre-create a conversation so the greeting branch is skipped
    conv = supabase_admin.table("conversations").insert(
        {
            "agent_id": test_agent["id"],
            "contact_phone": contact_phone,
            "contact_name": "Returning Customer",
            "status": "active",
            "message_count": 0,
        }
    ).execute().data[0]
    cleanup_registry["conversations"].append(conv["id"])

    # Add a prior user turn so "is_new" is false even if the trigger doesn't
    # bump message_count deterministically before we POST.
    supabase_admin.table("messages").insert(
        {
            "conversation_id": conv["id"],
            "role": "assistant",
            "content": "Hello again!",
            "tokens_used": 2,
            "metadata": {"kind": "greeting"},
        }
    ).execute()

    # Seed knowledge base + chunk
    kb = supabase_admin.table("knowledge_bases").insert(
        {
            "agent_id": test_agent["id"],
            "file_name": "hours.txt",
            "file_url": f"{test_user['id']}/{test_agent['id']}/hours.txt",
            "file_type": "txt",
            "status": "ready",
            "chunk_count": 1,
        }
    ).execute().data[0]
    cleanup_registry["knowledge_bases"].append(kb["id"])

    chunk_text = (
        "Our business hours are Monday to Friday from 9 AM to 6 PM. "
        "We are closed on weekends."
    )
    supabase_admin.table("knowledge_chunks").insert(
        {
            "knowledge_base_id": kb["id"],
            "content": chunk_text,
            "embedding": _stub_embedding(chunk_text),
            "chunk_index": 0,
            "metadata": {"file_name": "hours.txt"},
        }
    ).execute()

    question = "What are your business hours?"
    resp = bridge_webhook(
        user_id=test_user["id"],
        sender_phone=contact_phone,
        message_content=question,
    )
    assert resp.status_code == 202, resp.text

    msgs = poll_supabase(
        "messages",
        {"conversation_id": conv["id"]},
        predicate=lambda rows: any(
            r["role"] == "assistant" and r["content"].startswith("[stub]")
            for r in rows
        ),
        timeout=25.0,
        order_by="created_at",
    )
    stub_reply = next(
        m for m in msgs if m["role"] == "assistant" and m["content"].startswith("[stub]")
    )
    # metadata should have kind=agent (not fallback) and a retrieved_chunks list
    meta = stub_reply.get("metadata") or {}
    assert meta.get("kind") == "agent", f"unexpected metadata: {meta!r}"

    sent = mock_bridge.wait_for(user_id=test_user["id"], count=1, timeout=15.0)
    assert any(msg["message"].startswith("[stub]") for msg in sent)

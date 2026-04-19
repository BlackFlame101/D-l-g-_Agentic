"""E2E: knowledge upload -> indexing pipeline with stub embeddings.

Flow:
1. Upload a small ``.txt`` file directly to Supabase Storage using the admin
   client at ``{user_id}/{agent_id}/<file>.txt`` (matching the RLS path).
2. As the user, ``POST /api/agents/{agent_id}/knowledge`` with the storage path.
3. Poll ``knowledge_bases.status`` until it flips to ``ready`` (or fail the
   test on ``failed``).
4. Assert ``knowledge_chunks`` rows exist with the expected content and a
   768-d embedding.
"""

from __future__ import annotations

import time
import uuid

import pytest

from core.config import settings
from services.supabase import get_admin_client

pytestmark = [pytest.mark.e2e]


@pytest.fixture
def uploaded_file(supabase_admin, test_user, test_agent):
    """Put a small text file into Supabase Storage; return its path."""
    text = (
        "Delege opens from Monday to Friday 9am to 6pm. "
        "Saturday we open from 10am to 2pm. "
        "Closed on Sunday."
    )
    file_bytes = text.encode("utf-8")
    path = f"{test_user['id']}/{test_agent['id']}/hours-{uuid.uuid4().hex[:6]}.txt"
    bucket = settings.knowledge_bucket

    admin = get_admin_client()
    try:
        admin.storage.from_(bucket).upload(
            path=path,
            file=file_bytes,
            file_options={"content-type": "text/plain", "upsert": "true"},
        )
    except Exception as exc:
        pytest.skip(f"Supabase Storage upload failed ({bucket}/{path}): {exc}")

    yield {"path": path, "name": path.rsplit("/", 1)[-1], "size": len(file_bytes), "text": text}

    try:
        admin.storage.from_(bucket).remove([path])
    except Exception:
        pass


def test_knowledge_upload_indexes_with_stub_embeddings(
    api_server,
    celery_worker,
    authed_client,
    supabase_jwt,
    supabase_admin,
    poll_supabase,
    test_user,
    test_agent,
    test_subscription,
    uploaded_file,
    cleanup_registry,
):
    token = supabase_jwt(test_user["email"], test_user["password"])

    with authed_client(token) as client:
        resp = client.post(
            f"/api/agents/{test_agent['id']}/knowledge",
            json={
                "storage_path": uploaded_file["path"],
                "file_name": uploaded_file["name"],
                "file_type": "txt",
                "file_size_bytes": uploaded_file["size"],
            },
        )
    assert resp.status_code == 202, resp.text
    kb = resp.json()
    cleanup_registry["knowledge_bases"].append(kb["id"])

    # Poll KB status until it finishes (ready) or fails
    kb_rows = poll_supabase(
        "knowledge_bases",
        {"id": kb["id"]},
        predicate=lambda rows: bool(rows) and rows[0].get("status") in ("ready", "failed"),
        timeout=45.0,
    )
    final = kb_rows[0]
    assert final["status"] == "ready", f"Indexing failed: {final}"
    assert int(final["chunk_count"] or 0) >= 1

    chunks = (
        supabase_admin.table("knowledge_chunks")
        .select("id,content,embedding,metadata")
        .eq("knowledge_base_id", kb["id"])
        .execute()
        .data
        or []
    )
    assert chunks, "No chunks inserted"
    assert any("Delege" in (c.get("content") or "") for c in chunks)
    first_emb = chunks[0]["embedding"]
    # Supabase returns vector as list or stringified. Accept both.
    if isinstance(first_emb, str):
        first_emb = [float(x) for x in first_emb.strip("[]").split(",") if x.strip()]
    assert len(first_emb) == settings.gemini_embedding_dimensions

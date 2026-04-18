"""Supabase Storage helpers (service-role downloads for the indexer)."""

from __future__ import annotations

from core.config import settings
from core.logging import get_logger
from services.supabase import get_admin_client

logger = get_logger(__name__)


def download_file(storage_path: str, bucket: str | None = None) -> bytes:
    """Download a file from Supabase Storage using the service-role client.

    ``storage_path`` is the path *inside* the bucket (``user_id/agent_id/file``),
    matching the RLS policy laid down in Phase 1.13.
    """
    bucket_name = bucket or settings.knowledge_bucket
    admin = get_admin_client()
    try:
        result = admin.storage.from_(bucket_name).download(storage_path)
    except Exception as exc:
        logger.error(
            "Storage download failed",
            extra={"error": str(exc), "bucket": bucket_name, "path": storage_path},
        )
        raise

    if isinstance(result, (bytes, bytearray)):
        return bytes(result)
    if hasattr(result, "read"):
        return result.read()
    raise RuntimeError(f"Unexpected download result type: {type(result)!r}")

"""Document text extraction and chunking utilities."""

from __future__ import annotations

import io
import re
from typing import Iterable, List

from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


SUPPORTED_FILE_TYPES = {"pdf", "docx", "txt", "md"}


def _normalize_file_type(file_type: str | None, file_name: str | None) -> str:
    ft = (file_type or "").strip().lower().lstrip(".")
    if ft in SUPPORTED_FILE_TYPES:
        return ft
    if file_name and "." in file_name:
        ext = file_name.rsplit(".", 1)[1].lower()
        if ext in SUPPORTED_FILE_TYPES:
            return ext
    return ft


def extract_text(
    file_bytes: bytes,
    file_type: str | None = None,
    file_name: str | None = None,
) -> str:
    """Extract plain text from a PDF, DOCX, TXT or Markdown file."""
    kind = _normalize_file_type(file_type, file_name)

    if kind == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception as exc:  # pragma: no cover - rare
                logger.warning("PDF page extraction failed", extra={"error": str(exc)})
        return "\n\n".join(p for p in pages if p.strip())

    if kind == "docx":
        from docx import Document

        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text)

    if kind in ("txt", "md", ""):
        for encoding in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                return file_bytes.decode(encoding)
            except UnicodeDecodeError:
                continue
        return file_bytes.decode("utf-8", errors="ignore")

    raise ValueError(f"Unsupported file type: {kind}")


_WHITESPACE_RE = re.compile(r"\s+")


def _collapse_whitespace(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def chunk_text(
    text: str,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> List[str]:
    """Split ``text`` into overlapping windows.

    Operates on characters (not tokens) to keep dependencies minimal and to
    stay portable across Python 3.14. The embedding model comfortably handles
    chunks in this size range.
    """
    size = chunk_size or settings.knowledge_chunk_size
    ov = overlap if overlap is not None else settings.knowledge_chunk_overlap
    if size <= 0:
        raise ValueError("chunk_size must be positive")
    if ov >= size:
        raise ValueError("overlap must be smaller than chunk_size")

    normalized = _collapse_whitespace(text)
    if not normalized:
        return []
    if len(normalized) <= size:
        return [normalized]

    chunks: list[str] = []
    start = 0
    step = size - ov
    while start < len(normalized):
        end = min(start + size, len(normalized))
        window = normalized[start:end]
        last_break = max(window.rfind(". "), window.rfind("? "), window.rfind("! "))
        if end < len(normalized) and last_break > size // 2:
            end = start + last_break + 1
            window = normalized[start:end]
        chunks.append(window.strip())
        if end >= len(normalized):
            break
        start = max(0, end - ov)
        if start + step > len(normalized):
            tail = normalized[start:].strip()
            if tail and tail != chunks[-1]:
                chunks.append(tail)
            break
    return [c for c in chunks if c]


def iter_batches(items: Iterable, batch_size: int) -> Iterable[list]:
    """Yield successive ``batch_size`` chunks from ``items``."""
    batch: list = []
    for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch

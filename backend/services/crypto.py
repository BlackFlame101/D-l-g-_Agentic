"""Helpers to encrypt/decrypt third-party integration secrets."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings


def _get_fernet() -> Fernet:
    raw = (settings.integration_encryption_key or "").strip()
    if not raw:
        raise RuntimeError("INTEGRATION_ENCRYPTION_KEY is not set.")
    try:
        return Fernet(raw.encode("utf-8"))
    except Exception as exc:
        raise RuntimeError("INTEGRATION_ENCRYPTION_KEY is invalid.") from exc


def encrypt(plaintext: str) -> str:
    value = (plaintext or "").strip()
    if not value:
        raise ValueError("Cannot encrypt an empty value.")
    return _get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    value = (token or "").strip()
    if not value:
        raise ValueError("Cannot decrypt an empty value.")
    try:
        return _get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Encrypted integration token is invalid.") from exc

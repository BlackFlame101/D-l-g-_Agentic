"""Send a fake WhatsApp webhook payload to the local FastAPI backend.

Usage::

    python scripts/test_webhook.py --user-id <uuid> --phone 2126XXXXXXXX --text "Hello"

This is the smoke test referenced by Phase 3 task 3.26. It mimics the payload
the Node.js bridge forwards so you can exercise the Celery pipeline end-to-end
without scanning a real WhatsApp QR.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

# Allow the script to be run directly from the backend folder
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from core.config import settings  # noqa: E402


def build_payload(user_id: str, phone: str, text: str, name: str | None) -> dict:
    clean_phone = phone.lstrip("+")
    return {
        "userId": user_id,
        "senderPhone": clean_phone,
        "senderName": name,
        "senderJid": f"{clean_phone}@s.whatsapp.net",
        "messageContent": text,
        "messageType": "text",
        "messageId": uuid.uuid4().hex,
        "timestamp": int(time.time()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Post a fake WhatsApp webhook event.")
    parser.add_argument("--user-id", required=True, help="Supabase user id that owns the agent.")
    parser.add_argument("--phone", required=True, help="Contact phone in E.164 (digits only).")
    parser.add_argument("--text", default="Bonjour, je voulais des infos sur vos produits.")
    parser.add_argument("--name", default="Test Contact")
    parser.add_argument(
        "--url",
        default="http://localhost:8000/api/webhook/whatsapp",
        help="Target webhook URL.",
    )
    parser.add_argument(
        "--secret",
        default=settings.whatsapp_bridge_api_secret,
        help="X-API-Secret header value (defaults to .env).",
    )
    args = parser.parse_args()

    payload = build_payload(args.user_id, args.phone, args.text, args.name)
    headers = {"Content-Type": "application/json", "X-API-Secret": args.secret}

    print(f"POST {args.url}")
    print("Payload:", json.dumps(payload, indent=2))
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(args.url, json=payload, headers=headers)

    print(f"Status: {resp.status_code}")
    try:
        print("Body:", json.dumps(resp.json(), indent=2, ensure_ascii=False))
    except ValueError:
        print("Body:", resp.text)

    return 0 if resp.status_code < 400 else 1


if __name__ == "__main__":
    raise SystemExit(main())

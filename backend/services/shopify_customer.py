"""Shopify customer + order lookup for agent context injection."""

from __future__ import annotations

import re
from typing import Optional

import httpx

from core.logging import get_logger

logger = get_logger(__name__)


_ORDER_KEYWORDS = {
    # Darija
    "commande", "tlab", "mshtariat", "livraison", "twassal", "wsslt",
    "fin", "imta", "waqt", "tracking", "colis", "colisé", "suivi",
    "payment", "khalsit", "mzyan", "retour", "renvoi", "annuler",
    "annulation", "wsslek", "ghadi", "tji", "delivery", "shipped",
    # French
    "livrer", "expédié", "expédition", "remboursement", "retourner",
    "annuler", "statut", "numéro", "référence", "facture",
    # English
    "order", "delivery", "shipped", "tracking", "refund", "return",
    "cancel", "status", "invoice", "receipt", "payment", "arrived",
    "when", "where",
}


def _message_is_order_related(message: str) -> bool:
    """
    Quick keyword check — returns True if the message is likely
    about an order, delivery, or payment. Skips Shopify API calls
    for greetings, product questions, and general chat.
    """
    lower = message.lower()
    return any(kw in lower for kw in _ORDER_KEYWORDS)


def _normalize_phone_for_shopify(phone: str) -> list[str]:
    """
    Return candidate phone formats Shopify might have stored.
    Shopify stores phones inconsistently — try multiple formats.
    """
    digits = re.sub(r"\D", "", phone or "")
    candidates = []

    # e.g. 2126XXXXXXXX → try +2126XXXXXXXX, 06XXXXXXXX
    if digits.startswith("212") and len(digits) == 12:
        candidates.append(f"+{digits}")
        candidates.append(f"0{digits[3:]}")
    # e.g. 06XXXXXXXX → try +2126XXXXXXXX, 06XXXXXXXX
    elif digits.startswith("0") and len(digits) == 10:
        candidates.append(f"+212{digits[1:]}")
        candidates.append(digits)
    else:
        candidates.append(f"+{digits}")
        candidates.append(digits)

    return candidates


def _format_order(order: dict) -> str:
    """Format a single Shopify order as a readable context block."""
    name = order.get("name", "")
    financial = order.get("financial_status", "unknown")
    fulfillment = order.get("fulfillment_status") or "unfulfilled"
    total = order.get("total_price", "0.00")
    currency = order.get("currency", "")
    created = (order.get("created_at") or "")[:10]  # just the date

    items = order.get("line_items") or []
    item_lines = []
    for item in items[:5]:
        qty = item.get("quantity", 1)
        title = item.get("title", "")
        item_lines.append(f"    - {qty}x {title}")
    items_text = "\n".join(item_lines) if item_lines else "    - (no items)"

    # Tracking info
    tracking_lines = []
    for fulfillment_obj in (order.get("fulfillments") or []):
        tracking_number = fulfillment_obj.get("tracking_number")
        tracking_url = fulfillment_obj.get("tracking_url")
        carrier = fulfillment_obj.get("tracking_company", "")
        if tracking_number:
            line = f"    - {carrier} #{tracking_number}"
            if tracking_url:
                line += f" ({tracking_url})"
            tracking_lines.append(line)
    tracking_text = "\n".join(tracking_lines) if tracking_lines else "    - No tracking yet"

    return (
        f"  Order {name} ({created})\n"
        f"  Payment: {financial} | Fulfillment: {fulfillment}\n"
        f"  Total: {total} {currency}\n"
        f"  Items:\n{items_text}\n"
        f"  Tracking:\n{tracking_text}"
    )


def _search_customer_by_phone(
    store_url: str,
    access_token: str,
    phone: str,
) -> Optional[dict]:
    """Search Shopify for a customer by phone number, trying multiple formats."""
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json",
    }
    candidates = _normalize_phone_for_shopify(phone)

    with httpx.Client(timeout=10.0) as client:
        for candidate in candidates:
            try:
                resp = client.get(
                    f"https://{store_url}/admin/api/2026-04/customers/search.json",
                    params={"query": f"phone:{candidate}", "limit": 1},
                    headers=headers,
                )
                if resp.status_code == 200:
                    customers = resp.json().get("customers") or []
                    if customers:
                        return customers[0]
            except Exception as exc:
                logger.warning(
                    "Shopify phone search failed",
                    extra={"candidate": candidate, "error": str(exc)},
                )
    return None


def _search_customer_by_email(
    store_url: str,
    access_token: str,
    email: str,
) -> Optional[dict]:
    """Search Shopify for a customer by email."""
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=10.0) as client:
        try:
            resp = client.get(
                f"https://{store_url}/admin/api/2026-04/customers/search.json",
                params={"query": f"email:{email}", "limit": 1},
                headers=headers,
            )
            if resp.status_code == 200:
                customers = resp.json().get("customers") or []
                if customers:
                    return customers[0]
        except Exception as exc:
            logger.warning(
                "Shopify email search failed",
                extra={"email": email, "error": str(exc)},
            )
    return None


def _get_customer_orders(
    store_url: str,
    access_token: str,
    customer_id: int,
) -> list[dict]:
    """Fetch the 3 most recent orders for a customer."""
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=10.0) as client:
        try:
            resp = client.get(
                f"https://{store_url}/admin/api/2026-04/orders.json",
                params={
                    "customer_id": customer_id,
                    "limit": 3,
                    "status": "any",
                    "order": "created_at desc",
                },
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json().get("orders") or []
        except Exception as exc:
            logger.warning(
                "Shopify orders fetch failed",
                extra={"customer_id": customer_id, "error": str(exc)},
            )
    return []


def build_shopify_context(
    store_url: str,
    access_token: str,
    sender_phone: str,
    sender_email: Optional[str] = None,
    user_message: str = "",
) -> Optional[str]:
    """
    Look up a customer in Shopify by phone (then email) and return
    a formatted context block to inject into the agent system prompt.
    Returns None if no customer found or on any error.
    """
    try:
        # Skip Shopify lookup for messages that aren't order-related
        if user_message and not _message_is_order_related(user_message):
            logger.debug(
                "Skipping Shopify lookup — message not order-related",
                extra={"phone": sender_phone[:6] + "****"},
            )
            return None

        # Try phone first
        customer = _search_customer_by_phone(store_url, access_token, sender_phone)

        # Fall back to email if provided and phone lookup failed
        if not customer and sender_email:
            customer = _search_customer_by_email(store_url, access_token, sender_email)

        if not customer:
            return None

        customer_id = customer.get("id")
        first_name = customer.get("first_name") or ""
        last_name = customer.get("last_name") or ""
        full_name = f"{first_name} {last_name}".strip() or "Unknown"
        orders_count = customer.get("orders_count", 0)
        total_spent = customer.get("total_spent", "0.00")
        currency = customer.get("currency", "")

        orders = _get_customer_orders(store_url, access_token, customer_id) if customer_id else []

        orders_text = ""
        if orders:
            formatted = [_format_order(o) for o in orders]
            orders_text = "\n\n".join(formatted)
        else:
            orders_text = "  No orders found."

        context = (
            f"[SHOPIFY CUSTOMER CONTEXT]\n"
            f"Customer: {full_name}\n"
            f"Total orders: {orders_count} | Total spent: {total_spent} {currency}\n"
            f"\nRecent orders:\n{orders_text}\n"
            f"[END SHOPIFY CONTEXT]"
        )

        logger.info(
            "Shopify context built",
            extra={
                "customer_id": customer_id,
                "orders_found": len(orders),
                "phone": sender_phone[:6] + "****",
            },
        )
        return context

    except Exception as exc:
        logger.warning(
            "Failed to build Shopify context",
            extra={"error": str(exc), "phone": sender_phone[:6] + "****"},
        )
        return None

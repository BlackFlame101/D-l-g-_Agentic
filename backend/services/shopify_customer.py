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
    digits = re.sub(r"\D", "", phone or "")
    candidates = []

    if digits.startswith("212") and len(digits) == 12:
        local = digits[3:]  # 680196588
        candidates.append(f"+212{local}")      # +212680196588 ← Shopify format
        candidates.append(f"0{local}")          # 0680196588
        candidates.append(digits)               # 212680196588
        candidates.append(f"+{digits}")         # +212680196588 (duplicate safety)
    elif digits.startswith("0") and len(digits) == 10:
        local = digits[1:]  # 680196588
        candidates.append(f"+212{local}")       # +212680196588 ← Shopify format
        candidates.append(digits)               # 0680196588
        candidates.append(f"212{local}")        # 212680196588
    else:
        candidates.append(f"+{digits}")
        candidates.append(digits)

    # Deduplicate while preserving order
    seen = set()
    return [c for c in candidates if not (c in seen or seen.add(c))]


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
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json",
    }
    candidates = _normalize_phone_for_shopify(phone)

    with httpx.Client(timeout=10.0) as client:
        for candidate in candidates:
            try:
                # Shopify search works better without + in the query string
                # Try both with and without URL encoding the +
                resp = client.get(
                    f"https://{store_url}/admin/api/2024-01/customers/search.json",
                    params={"query": f"phone:{candidate}", "limit": 1},
                    headers=headers,
                )
                if resp.status_code == 200:
                    customers = resp.json().get("customers") or []
                    if customers:
                        logger.info(
                            "Shopify customer found by phone",
                            extra={"candidate": candidate},
                        )
                        return customers[0]
                else:
                    logger.warning(
                        "Shopify phone search non-200",
                        extra={"candidate": candidate, "status": resp.status_code, "body": resp.text[:200]},
                    )
            except Exception as exc:
                logger.warning(
                    "Shopify phone search failed",
                    extra={"candidate": candidate, "error": str(exc)},
                )

        # Last resort — fetch all customers and match manually
        # Shopify search can be flaky with international numbers
        try:
            local_digits = re.sub(r"\D", "", phone)
            if local_digits.startswith("212"):
                local_digits = local_digits[3:]  # 680196588
            elif local_digits.startswith("0"):
                local_digits = local_digits[1:]  # 680196588

            resp = client.get(
                f"https://{store_url}/admin/api/2024-01/customers.json",
                params={"limit": 250},
                headers=headers,
            )
            if resp.status_code == 200:
                for customer in resp.json().get("customers") or []:
                    stored = re.sub(r"\D", "", customer.get("phone") or "")
                    if stored.endswith(local_digits):
                        logger.info(
                            "Shopify customer found by suffix match",
                            extra={"local_digits": local_digits},
                        )
                        return customer
        except Exception as exc:
            logger.warning(
                "Shopify suffix match fallback failed",
                extra={"error": str(exc)},
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
                f"https://{store_url}/admin/api/2024-01/customers/search.json",
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
                f"https://{store_url}/admin/api/2024-01/orders.json",
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

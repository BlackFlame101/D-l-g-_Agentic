"""Agno tool wrappers around Shopify service calls."""
from __future__ import annotations
import asyncio
from typing import Any, Coroutine
from agno.tools import tool
from core.logging import get_logger
from services.tools import shopify as shopify_api

logger = get_logger(__name__)


def _run(coro: Coroutine[Any, Any, dict]) -> dict:
    """Run a coroutine synchronously, safe for Celery prefork workers."""
    try:
        asyncio.get_running_loop()
        # If we're inside a running loop (shouldn't happen in Celery prefork)
        # but if it does, raise clearly instead of deadlocking
        raise RuntimeError(
            "Cannot call Shopify tool from inside a running event loop. "
            "Check that the Celery worker is using prefork (not gevent/eventlet)."
        )
    except RuntimeError as e:
        if "no running event loop" in str(e).lower() or "no current event loop" in str(e).lower():
            # Normal Celery prefork path — safe to create a new loop
            return asyncio.run(coro)
        raise


def make_shopify_tools(store_url: str, access_token: str) -> list:

    @tool
    def search_products(query: str) -> str:
        """Search products by name or keyword for pricing and availability questions."""
        logger.info("Shopify product search started", extra={"query": query})
        try:
            result = _run(shopify_api.search_products(store_url, access_token, query))
        except Exception as exc:
            # LOG THE ACTUAL ERROR — this is what was missing before
            logger.error(
                "Shopify product search raised exception",
                extra={"query": query, "error": str(exc), "error_type": type(exc).__name__},
                exc_info=True,
            )
            return "I couldn't retrieve product information right now. Please try again shortly."

        logger.info("Shopify product search result", extra={"query": query, "raw_result": result})

        products = result.get("products") or []
        if not products:
            # Also log what came back so you can see if it's an empty list vs a bad response
            logger.warning(
                "Shopify product search returned no products",
                extra={"query": query, "result_keys": list(result.keys())},
            )
            return f"No products found matching '{query}'."

        lines: list[str] = []
        for product in products:
            stock = "In stock" if product.get("in_stock") else "Out of stock"
            lines.append(
                f"- {product.get('name')}: {product.get('price')} {product.get('currency')} ({stock})"
            )
        return "\n".join(lines)

    @tool
    def check_order_status(identifier: str) -> str:
        """Check order status using order number, email, or phone number."""
        raw = (identifier or "").strip()
        logger.info("Shopify order lookup started", extra={"identifier_type": _guess_id_type(raw)})
        try:
            result = {"found": False}
            if raw.startswith("#") or raw.isdigit():
                result = _run(shopify_api.get_order_by_number(store_url, access_token, raw))
                logger.info("Order by number result", extra={"found": result.get("found")})

            if not result.get("found") and "@" in raw:
                result = _run(shopify_api.get_order_by_email(store_url, access_token, raw))
                logger.info("Order by email result", extra={"found": result.get("found")})

            if not result.get("found"):
                result = _run(shopify_api.get_order_by_phone(store_url, access_token, raw))
                logger.info("Order by phone result", extra={"found": result.get("found")})

        except Exception as exc:
            logger.error(
                "Shopify order lookup raised exception",
                extra={"error": str(exc), "error_type": type(exc).__name__},
                exc_info=True,
            )
            return "I couldn't retrieve order information right now. Please try again shortly."

        if not result.get("found"):
            return (
                "I couldn't find an order with that information. "
                "Please double-check your order number or contact the store directly."
            )

        items = ", ".join(result.get("items") or []) or "No items listed"
        return (
            f"Order {result.get('order_number')}: "
            f"Payment — {result.get('payment_status')}, "
            f"Delivery — {result.get('fulfillment_status')}. "
            f"Items: {items}."
        )

    return [search_products, check_order_status]


def _guess_id_type(raw: str) -> str:
    if raw.startswith("#") or raw.isdigit():
        return "order_number"
    if "@" in raw:
        return "email"
    return "phone"
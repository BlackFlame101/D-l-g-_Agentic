"""Agno tool wrappers around Shopify service calls."""

from __future__ import annotations

import asyncio
from typing import Any, Coroutine

from agno.tools import tool

from core.logging import get_logger
from services.tools import shopify as shopify_api

logger = get_logger(__name__)


def _run(coro: Coroutine[Any, Any, dict]) -> dict:
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    if running_loop.is_running():
        raise RuntimeError("Cannot execute Shopify tool inside a running event loop.")
    return running_loop.run_until_complete(coro)


def make_shopify_tools(store_url: str, access_token: str) -> list:
    @tool
    def search_products(query: str) -> str:
        """Search products by name/keyword for pricing and stock questions."""
        try:
            result = _run(shopify_api.search_products(store_url, access_token, query))
        except Exception as exc:
            logger.warning("Shopify product search failed", extra={"error": str(exc)})
            return "I couldn't retrieve product information right now. Please try again shortly."

        products = result.get("products") or []
        if not products:
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
        """Check order status using order number, then email, then phone fallback."""
        raw = (identifier or "").strip()
        try:
            result = {"found": False}
            if raw.startswith("#") or raw.isdigit():
                result = _run(shopify_api.get_order_by_number(store_url, access_token, raw))
            if not result.get("found") and "@" in raw:
                result = _run(shopify_api.get_order_by_email(store_url, access_token, raw))
            if not result.get("found"):
                result = _run(shopify_api.get_order_by_phone(store_url, access_token, raw))
        except Exception as exc:
            logger.warning("Shopify order lookup failed", extra={"error": str(exc)})
            return "I couldn't retrieve order information right now. Please try again shortly."

        if not result.get("found"):
            return (
                "I couldn't find an order with that information. "
                "Please double-check your order number or contact the store directly."
            )

        items = ", ".join(result.get("items") or []) or "No items listed"
        return (
            f"Order {result.get('order_number')}: "
            f"Payment - {result.get('payment_status')}, "
            f"Delivery - {result.get('fulfillment_status')}. "
            f"Items: {items}."
        )

    return [search_products, check_order_status]

"""Shopify REST helpers used by Agno tools."""

from __future__ import annotations

import re
from typing import Any

import httpx

SHOPIFY_API_VERSION = "2024-01"


def _headers(token: str) -> dict[str, str]:
    return {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
    }


def _base_url(store_url: str) -> str:
    host = (store_url or "").strip().replace("https://", "").replace("http://", "")
    host = host.strip("/")
    return f"https://{host}/admin/api/{SHOPIFY_API_VERSION}"


async def search_products(store_url: str, access_token: str, query: str) -> dict[str, Any]:
    """Search products by title keyword and return a compact summary payload."""
    url = f"{_base_url(store_url)}/products.json"
    params = {
        "title": (query or "").strip(),
        "limit": 5,
        "fields": "id,title,status,variants,images",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=_headers(access_token), params=params)
        resp.raise_for_status()

    products = resp.json().get("products", [])
    results: list[dict[str, Any]] = []
    for product in products:
        if product.get("status") != "active":
            continue
        variant = product["variants"][0] if product.get("variants") else {}
        results.append(
            {
                "name": product.get("title"),
                "price": variant.get("price"),
                "currency": "MAD",
                "in_stock": int(variant.get("inventory_quantity") or 0) > 0,
            }
        )
    return {"products": results, "count": len(results)}


def _format_order(order: dict[str, Any]) -> dict[str, Any]:
    return {
        "found": True,
        "order_number": order.get("name"),
        "payment_status": order.get("financial_status"),
        "fulfillment_status": order.get("fulfillment_status") or "pending",
        "items": [item.get("title", "") for item in (order.get("line_items") or []) if item.get("title")],
        "created_at": order.get("created_at"),
    }


async def get_order_by_number(store_url: str, access_token: str, order_number: str) -> dict[str, Any]:
    url = f"{_base_url(store_url)}/orders.json"
    normalized = (order_number or "").strip()
    if normalized and not normalized.startswith("#"):
        normalized = f"#{normalized}"
    params = {
        "name": normalized,
        "limit": 1,
        "status": "any",
        "fields": "id,name,financial_status,fulfillment_status,line_items,created_at,email,phone",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=_headers(access_token), params=params)
        resp.raise_for_status()
    orders = resp.json().get("orders", [])
    return _format_order(orders[0]) if orders else {"found": False}


async def get_order_by_email(store_url: str, access_token: str, email: str) -> dict[str, Any]:
    url = f"{_base_url(store_url)}/orders.json"
    params = {
        "email": (email or "").strip().lower(),
        "limit": 1,
        "status": "any",
        "fields": "id,name,financial_status,fulfillment_status,line_items,created_at,email,phone",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=_headers(access_token), params=params)
        resp.raise_for_status()
    orders = resp.json().get("orders", [])
    return _format_order(orders[0]) if orders else {"found": False}


async def get_order_by_phone(store_url: str, access_token: str, phone: str) -> dict[str, Any]:
    """Fetch recent orders then filter by phone (REST has no direct phone filter)."""
    url = f"{_base_url(store_url)}/orders.json"
    params = {
        "limit": 25,
        "status": "any",
        "fields": "id,name,financial_status,fulfillment_status,line_items,created_at,email,phone",
    }
    digits = re.sub(r"\D", "", phone or "")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=_headers(access_token), params=params)
        resp.raise_for_status()
    orders = resp.json().get("orders", [])
    for order in orders:
        order_phone_digits = re.sub(r"\D", "", order.get("phone") or "")
        if digits and (digits in order_phone_digits or order_phone_digits in digits):
            return _format_order(order)
    return {"found": False}

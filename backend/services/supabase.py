"""Supabase client utilities.

Exposes two clients:

* ``get_admin_client`` - a process-wide service-role client used by the
  webhook handler, Celery workers and anything that needs to bypass RLS.
* ``get_user_client`` - a per-request anon client bound to a user's JWT.
  All reads/writes through it are subject to the user's RLS policies.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from core.config import settings


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """Return a cached Supabase client authenticated with the service role key."""
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in the environment."
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_user_client(access_token: str) -> Client:
    """Return a Supabase anon client bound to the given user JWT.

    The client enforces row level security as the authenticated user. A fresh
    client is returned per call to avoid leaking a token across requests.
    """
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY."
        )
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client

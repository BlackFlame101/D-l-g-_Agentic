"""Dashboard CRUD endpoints for the ``agents`` table."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from core.logging import get_logger
from core.security import CurrentUser, get_current_user
from schemas.agent import AgentCreate, AgentOut, AgentUpdate
from services.supabase import get_admin_client

logger = get_logger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_user_agent(agent_id: UUID, user_id: str) -> dict:
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("id", str(agent_id))
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found.")
    return resp.data[0]


@router.get("", response_model=List[AgentOut])
async def list_agents(user: CurrentUser = Depends(get_current_user)) -> List[AgentOut]:
    """Return every non-deleted agent owned by the caller."""
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .select("*")
        .eq("user_id", user.id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return [AgentOut.model_validate(row) for row in (resp.data or [])]


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    return AgentOut.model_validate(_fetch_user_agent(agent_id, user.id))


@router.post("", response_model=AgentOut, status_code=status.HTTP_201_CREATED)
async def create_agent(
    payload: AgentCreate,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    """Create an agent for the authenticated user."""
    admin = get_admin_client()
    data = payload.model_dump(exclude_none=True)
    data["user_id"] = user.id
    resp = admin.table("agents").insert(data).execute()
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create agent.",
        )
    return AgentOut.model_validate(resp.data[0])


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: UUID,
    payload: AgentUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> AgentOut:
    _fetch_user_agent(agent_id, user.id)
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update.",
        )
    updates["updated_at"] = _now_iso()
    admin = get_admin_client()
    resp = (
        admin.table("agents")
        .update(updates)
        .eq("id", str(agent_id))
        .eq("user_id", user.id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent.",
        )
    return AgentOut.model_validate(resp.data[0])


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: UUID,
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Soft-delete an agent by stamping ``deleted_at``."""
    _fetch_user_agent(agent_id, user.id)
    admin = get_admin_client()
    admin.table("agents").update(
        {"deleted_at": _now_iso(), "is_active": False}
    ).eq("id", str(agent_id)).eq("user_id", user.id).execute()


class GeneratePromptRequest(BaseModel):
    description: str = Field(min_length=10, max_length=1000)
    language: str = Field(default="fr")  # "ar", "fr", "en"


class GeneratePromptResponse(BaseModel):
    system_prompt: str
    greeting_message: str
    fallback_message: str


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_agent_prompt(
    body: GeneratePromptRequest,
    user: CurrentUser = Depends(get_current_user),
) -> GeneratePromptResponse:
    """Use Gemini to generate system prompt + greeting + fallback from a description."""
    from google import genai
    from google.genai import types
    from core.config import settings

    lang_instruction = {
        "ar": "Write all three fields in Moroccan Darija (Arabic script).",
        "fr": "Write all three fields in French.",
        "en": "Write all three fields in English.",
        "darija": "Write all three fields in Moroccan Darija (Arabic script).",
    }.get(body.language, "Write all three fields in French.")

    prompt = f"""You are an expert at configuring WhatsApp AI agents for Moroccan businesses.

A business owner described what they want their agent to do:
"{body.description}"

{lang_instruction}

Generate a JSON object with exactly these three keys:
- system_prompt: A detailed system prompt for the AI agent (max 800 characters). Include personality, behavior rules, and what the agent should/should not do.
- greeting_message: A warm greeting the agent sends to new customers (max 200 characters).
- fallback_message: A message when the agent doesn't understand (max 200 characters).

Respond with ONLY valid JSON, no markdown, no explanation.
Example format:
{{"system_prompt": "...", "greeting_message": "...", "fallback_message": "..."}}"""

    try:
        client = genai.Client(api_key=settings.google_api_key)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=1000,
            ),
        )
        raw = (response.text or "").strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        import json
        data = json.loads(raw)
        return GeneratePromptResponse(
            system_prompt=str(data.get("system_prompt", ""))[:800],
            greeting_message=str(data.get("greeting_message", ""))[:200],
            fallback_message=str(data.get("fallback_message", ""))[:200],
        )
    except Exception as exc:
        logger.error("Prompt generation failed", extra={"error": str(exc), "type": type(exc).__name__})
        raise HTTPException(status_code=500, detail=f"Failed to generate prompt: {str(exc)}")

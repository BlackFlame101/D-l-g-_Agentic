import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/ws";

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error?.message || body?.detail || `Request failed: ${res.status}`
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// -- Agents --
export interface Agent {
  id: string;
  user_id: string;
  name: string;
  system_prompt: string | null;
  language: string | null;
  tone: string | null;
  greeting_message: string | null;
  fallback_message: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface AgentCreate {
  name: string;
  system_prompt?: string;
  language?: string;
  tone?: string;
  greeting_message?: string;
  fallback_message?: string;
  is_active?: boolean;
}

export type AgentUpdate = Partial<AgentCreate>;

export const agentsApi = {
  list: () => request<Agent[]>("/api/agents"),
  get: (id: string) => request<Agent>(`/api/agents/${id}`),
  create: (data: AgentCreate) =>
    request<Agent>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: AgentUpdate) =>
    request<Agent>(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/api/agents/${id}`, { method: "DELETE" }),
};

// -- Knowledge Base --
export interface KnowledgeBase {
  id: string;
  agent_id: string;
  file_name: string;
  file_url: string | null;
  file_type: string;
  file_size_bytes: number | null;
  status: string;
  error_message: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface KnowledgeIndexRequest {
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes?: number;
}

export const knowledgeApi = {
  list: (agentId: string) =>
    request<KnowledgeBase[]>(`/api/agents/${agentId}/knowledge`),
  upload: (agentId: string, data: KnowledgeIndexRequest) =>
    request<KnowledgeBase>(`/api/agents/${agentId}/knowledge`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (agentId: string, kbId: string) =>
    request<void>(`/api/agents/${agentId}/knowledge/${kbId}`, {
      method: "DELETE",
    }),
};

// -- Conversations --
export interface Conversation {
  id: string;
  agent_id: string;
  contact_phone: string;
  contact_name: string | null;
  status: string;
  message_count: number;
  created_at: string;
  updated_at: string | null;
  last_message_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const conversationsApi = {
  list: (params?: { agent_id?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params?.agent_id) sp.set("agent_id", params.agent_id);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return request<Conversation[]>(`/api/conversations${qs ? `?${qs}` : ""}`);
  },
  messages: (convId: string, params?: { limit?: number; before?: string }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.before) sp.set("before", params.before);
    const qs = sp.toString();
    return request<Message[]>(
      `/api/conversations/${convId}/messages${qs ? `?${qs}` : ""}`
    );
  },
};

// -- WhatsApp Bridge --
export function getWhatsAppQrWsUrl(userId: string): string {
  return `${WS_URL.replace("/ws", "")}/api/session/${userId}/qr`;
}

export async function getWhatsAppStatus(
  userId: string
): Promise<{ status: string; phone_number?: string }> {
  const res = await fetch(
    `${WS_URL.replace("ws://", "http://").replace("wss://", "https://").replace("/ws", "")}/api/session/${userId}/status`
  );
  if (!res.ok) throw new Error("Failed to get WhatsApp status");
  return res.json();
}

export async function disconnectWhatsApp(userId: string): Promise<void> {
  const baseUrl = WS_URL.replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace("/ws", "");
  const res = await fetch(`${baseUrl}/api/session/${userId}/disconnect`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to disconnect WhatsApp");
}

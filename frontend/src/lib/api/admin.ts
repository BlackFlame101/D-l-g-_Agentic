import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authedFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
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

export interface AdminPlan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_mad: number;
  message_limit: number;
  features: string[];
  is_active: boolean;
}

export interface AdminSubscription {
  id: string;
  user_id: string;
  plan_id: string | null;
  status: "pending" | "active" | "expired" | "cancelled";
  payment_method: string | null;
  payment_reference: string | null;
  message_limit: number;
  current_usage: number;
  activated_by: string | null;
  activated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
}

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  phone: string | null;
  language_preference: string | null;
  is_admin: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  subscription: AdminSubscription | null;
  messages_last_30d: number;
  tokens_last_30d: number;
}

export interface AdminUserUsageDay {
  date: string;
  messages_sent: number;
  tokens_consumed: number;
}

export interface AdminUserDetail extends AdminUser {
  subscriptions: AdminSubscription[];
  usage: AdminUserUsageDay[];
}

export interface AdminStats {
  total_users: number;
  active_subscriptions: number;
  pending_subscriptions: number;
  expiring_soon: number;
  messages_last_30d: number;
  estimated_mrr_mad: number;
}

export interface CreateSubscriptionInput {
  user_id: string;
  plan_id: string;
  payment_method: "bank_transfer" | "cashplus" | "cash";
  payment_reference?: string;
  expires_at: string;
  message_limit?: number;
}

export interface UpdateSubscriptionInput {
  status?: "pending" | "active" | "expired" | "cancelled";
  expires_at?: string;
  payment_reference?: string;
  message_limit?: number;
  current_usage?: number;
}

export const adminApi = {
  stats: () => authedFetch<AdminStats>("/api/admin/stats"),

  listUsers: (params?: {
    search?: string;
    sub_status?: "none" | "pending" | "active" | "expired" | "cancelled";
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.search) sp.set("search", params.search);
    if (params?.sub_status) sp.set("sub_status", params.sub_status);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return authedFetch<AdminUser[]>(`/api/admin/users${qs ? `?${qs}` : ""}`);
  },

  getUser: (userId: string) =>
    authedFetch<AdminUserDetail>(`/api/admin/users/${userId}`),

  listPlans: () => authedFetch<AdminPlan[]>("/api/admin/plans"),

  createSubscription: (data: CreateSubscriptionInput) =>
    authedFetch<AdminSubscription>("/api/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateSubscription: (subId: string, data: UpdateSubscriptionInput) =>
    authedFetch<AdminSubscription>(`/api/admin/subscriptions/${subId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  cancelSubscription: (subId: string) =>
    authedFetch<void>(`/api/admin/subscriptions/${subId}`, {
      method: "DELETE",
    }),
};

"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { conversationsApi } from "@/lib/api";
import type { Conversation } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Search, ChevronRight } from "lucide-react";
import Link from "next/link";

export default function ConversationsPage() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const { user } = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  async function loadConversations() {
    setLoading(true);
    try {
      const data = await conversationsApi.list({ limit: 100 });
      setConversations(data);
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.contact_name?.toLowerCase().includes(q) ||
      c.contact_phone.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-sm" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">
          {t("conversations.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("conversations.description")}
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t("conversations.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ps-10"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <MessageSquare className="mb-3 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search
              ? t("conversations.noResults")
              : t("conversations.empty")}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {filtered.map((conv) => (
              <Link
                key={conv.id}
                href={`/${locale}/dashboard/conversations/${conv.id}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-muted"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary/20 text-sm font-bold text-secondary">
                  {(conv.contact_name || conv.contact_phone)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {conv.contact_name || conv.contact_phone}
                    </p>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {conv.status}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {conv.contact_phone} · {conv.message_count}{" "}
                    {t("messages")}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {conv.last_message_at && (
                    <span>
                      {new Date(conv.last_message_at).toLocaleDateString(
                        locale,
                        { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
                      )}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

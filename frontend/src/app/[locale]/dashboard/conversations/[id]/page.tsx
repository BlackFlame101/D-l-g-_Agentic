"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { conversationsApi } from "@/lib/api";
import type { Message, Conversation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Bot, User } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ConversationDetailPage() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const { user } = useUser();
  const params = useParams();
  const convId = params.id as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingPause, setUpdatingPause] = useState(false);

  useEffect(() => {
    if (!user || !convId) return;
    loadMessages();
  }, [user, convId]);

  async function loadMessages() {
    setLoading(true);
    try {
      const list = await conversationsApi.list({ limit: 200 });
      const conv = list.find((c) => c.id === convId) || null;
      setConversation(conv);
      const data = await conversationsApi.messages(convId, { limit: 200 });
      setMessages(data);
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  }

  async function togglePause() {
    if (!conversation || updatingPause) return;
    setUpdatingPause(true);
    try {
      const updated = await conversationsApi.updatePause(convId, !conversation.is_paused);
      setConversation(updated);
    } finally {
      setUpdatingPause(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Link href={`/${locale}/dashboard/conversations`}>
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="font-heading text-base font-semibold text-foreground">
            {t("conversations.detail")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {messages.length} {t("messages")} · {t("conversations.readOnly")}
          </p>
        </div>
        <div className="ms-auto">
          <Button variant={conversation?.is_paused ? "default" : "outline"} onClick={togglePause} disabled={!conversation || updatingPause}>
            {conversation?.is_paused ? "Resume Agent" : "Pause Agent"}
          </Button>
        </div>
      </div>

      {/* Messages */}
      {loading ? (
        <div className="flex-1 space-y-4 py-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn("flex gap-2", i % 2 === 0 ? "" : "justify-end")}
            >
              <Skeleton className="h-12 w-3/5 rounded-2xl" />
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("conversations.noMessages")}
        </div>
      ) : (
        <ScrollArea className="flex-1 py-4">
          <div className="space-y-3">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", !isUser && "justify-end")}>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5",
          isUser
            ? "rounded-tl-sm bg-muted text-foreground"
            : "rounded-tr-sm bg-secondary text-secondary-foreground"
        )}
      >
        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        <p
          className={cn(
            "mt-1 text-[10px]",
            isUser ? "text-muted-foreground" : "text-secondary-foreground/70"
          )}
        >
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/20">
          <Bot className="h-4 w-4 text-secondary" />
        </div>
      )}
    </div>
  );
}

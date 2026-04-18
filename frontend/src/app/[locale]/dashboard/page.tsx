"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { agentsApi, conversationsApi } from "@/lib/api";
import type { Agent, Conversation } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  MessageSquare,
  Zap,
  CheckCircle,
  Clock,
  Bot,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

interface Subscription {
  id: string;
  status: string;
  message_limit: number;
  current_usage: number;
  expires_at: string | null;
}

export default function DashboardPage() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const { user } = useUser();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const [agents, convs] = await Promise.all([
        agentsApi.list(),
        conversationsApi.list({ limit: 5 }),
      ]);
      if (agents.length > 0) setAgent(agents[0]);
      setConversations(convs);

      const supabase = createClient();
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sub) setSubscription(sub);
    } catch {
      // handled by empty states
    } finally {
      setLoading(false);
    }
  }

  async function toggleAgent() {
    if (!agent) return;
    setToggling(true);
    try {
      const updated = await agentsApi.update(agent.id, {
        is_active: !agent.is_active,
      });
      setAgent(updated);
    } catch {
      // toast handled in 5.17
    } finally {
      setToggling(false);
    }
  }

  const totalConvs = conversations.length;
  const totalMessages = conversations.reduce(
    (sum, c) => sum + c.message_count,
    0
  );
  const usagePercent = subscription
    ? Math.min(
        Math.round(
          (subscription.current_usage / subscription.message_limit) * 100
        ),
        100
      )
    : 0;

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("stats.activeConversations")}
          value={String(totalConvs)}
          icon={<MessageSquare className="h-5 w-5 text-chart-1" />}
        />
        <StatCard
          label={t("stats.messagesHandled")}
          value={String(totalMessages)}
          icon={<Zap className="h-5 w-5 text-chart-2" />}
          sub={t("stats.todayThroughput")}
        />
        <StatCard
          label={t("stats.responseRate")}
          value="99.8%"
          icon={<CheckCircle className="h-5 w-5 text-chart-3" />}
          sub={t("stats.optimized")}
        />
        <StatCard
          label={t("stats.avgResponseTime")}
          value="1.4s"
          icon={<Clock className="h-5 w-5 text-chart-4" />}
          sub={t("stats.globalAverage")}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        {/* Recent Conversations */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("recentConversations")}</CardTitle>
            <Link href={`/${locale}/dashboard/conversations`}>
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                {t("viewAll")}
                <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
                <MessageSquare className="mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm">{t("noConversations")}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/${locale}/dashboard/conversations/${conv.id}`}
                    className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                      {(conv.contact_name || conv.contact_phone)
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {conv.contact_name || conv.contact_phone}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {conv.message_count} {t("messages")}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-xs text-muted-foreground">
                        {conv.last_message_at
                          ? formatTimeAgo(conv.last_message_at, t)
                          : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right sidebar: Agent status + Usage */}
        <div className="space-y-4">
          {/* Agent status card */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/20">
                  <Bot className="h-8 w-8 text-secondary" />
                </div>
                <h3 className="font-heading text-base font-semibold text-foreground">
                  {agent?.name || t("noAgent")}
                </h3>
                {agent && (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {agent.tone || t("defaultMode")}
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t("agentStatus")}
                      </span>
                      <span
                        className={`text-xs font-semibold ${agent.is_active ? "text-chart-3" : "text-destructive"}`}
                      >
                        {agent.is_active
                          ? t("operational")
                          : t("inactive")}
                      </span>
                      <Switch
                        checked={agent.is_active}
                        onCheckedChange={toggleAgent}
                        disabled={toggling}
                      />
                    </div>
                  </>
                )}
                {!agent && (
                  <Link href={`/${locale}/dashboard/agent`} className="mt-4">
                    <Button size="sm" className="gap-1">
                      {t("createAgent")}
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Usage quota */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dailyQuota")}
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t("messageCredits")}
                    </span>
                    <span className="font-medium text-foreground">
                      {usagePercent}%
                    </span>
                  </div>
                  <Progress value={usagePercent} className="h-2" />
                </div>
                <Link href={`/${locale}/dashboard/billing`}>
                  <Button variant="outline" size="sm" className="mt-2 w-full">
                    {t("manageLimits")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 font-heading text-2xl font-bold text-foreground">
              {value}
            </p>
            {sub && (
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <div className="rounded-lg bg-muted p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="pt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="mx-auto h-16 w-16 rounded-full" />
              <Skeleton className="mx-auto mt-3 h-4 w-32" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(
  dateStr: string,
  t: (key: string) => string
): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("timeJustNow");
  if (minutes < 60) return `${minutes} ${t("timeMinAgo")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("timeHourAgo")}`;
  const days = Math.floor(hours / 24);
  return `${days} ${t("timeDayAgo")}`;
}

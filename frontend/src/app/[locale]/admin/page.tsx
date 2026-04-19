"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { adminApi, type AdminStats } from "@/lib/api/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users,
  CreditCard,
  Clock,
  AlertTriangle,
  MessageSquare,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function AdminHomePage() {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminApi.stats();
        if (!cancelled) setStats(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errors.loadStats"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {t("home.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        <Link href={`/${locale}/admin/users`}>
          <Button variant="outline" size="sm" className="gap-1">
            {t("home.manageUsers")}
            <ArrowRight className="h-3 w-3 rtl:rotate-180" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={t("stats.totalUsers")}
          value={String(stats?.total_users ?? 0)}
          icon={<Users className="h-5 w-5 text-chart-1" />}
        />
        <StatCard
          label={t("stats.activeSubs")}
          value={String(stats?.active_subscriptions ?? 0)}
          icon={<CreditCard className="h-5 w-5 text-chart-3" />}
        />
        <StatCard
          label={t("stats.pendingSubs")}
          value={String(stats?.pending_subscriptions ?? 0)}
          icon={<Clock className="h-5 w-5 text-chart-4" />}
          sub={t("stats.pendingHint")}
        />
        <StatCard
          label={t("stats.expiringSoon")}
          value={String(stats?.expiring_soon ?? 0)}
          icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
          sub={t("stats.expiringHint")}
        />
        <StatCard
          label={t("stats.messages30d")}
          value={(stats?.messages_last_30d ?? 0).toLocaleString()}
          icon={<MessageSquare className="h-5 w-5 text-chart-2" />}
        />
        <StatCard
          label={t("stats.mrr")}
          value={`${(stats?.estimated_mrr_mad ?? 0).toLocaleString()} MAD`}
          icon={<TrendingUp className="h-5 w-5 text-chart-5" />}
          sub={t("stats.mrrHint")}
        />
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

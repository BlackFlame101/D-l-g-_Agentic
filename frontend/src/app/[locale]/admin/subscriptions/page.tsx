"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { adminApi, type AdminUser } from "@/lib/api/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, CreditCard } from "lucide-react";
import { toast } from "sonner";

export default function AdminSubscriptionsPage() {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adminApi.listUsers({
          sub_status: "active",
          limit: 200,
        });
        if (!cancelled) setUsers(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errors.loadUsers"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {t("subscriptions.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("subscriptions.subtitle")}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
              <CreditCard className="mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm">{t("subscriptions.empty")}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {users.map((u) => (
                <Link
                  key={u.id}
                  href={`/${locale}/admin/users/${u.id}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                    {(u.full_name || u.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {u.full_name || u.email || u.id.slice(0, 8)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.subscription
                        ? `${u.subscription.current_usage}/${u.subscription.message_limit} msg`
                        : "—"}
                      {u.subscription?.expires_at &&
                        ` · ${t("subscriptions.expires")} ${new Date(
                          u.subscription.expires_at
                        ).toLocaleDateString()}`}
                    </p>
                  </div>
                  {u.subscription && (
                    <Badge className="bg-chart-3/20 text-chart-3 text-xs">
                      {t(`status.${u.subscription.status}`)}
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

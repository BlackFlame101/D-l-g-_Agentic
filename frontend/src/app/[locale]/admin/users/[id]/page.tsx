"use client";

import { useEffect, useState, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { adminApi, type AdminUserDetail } from "@/lib/api/admin";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CreditCard, MessageSquare, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActivatePlanDialog } from "../../_components/ActivatePlanDialog";

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("Admin");
  const locale = useLocale();

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data = await adminApi.getUser(id);
      setUser(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errors.loadUser"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function cancelSub(subId: string) {
    if (!confirm(t("user.confirmCancel"))) return;
    setActivating(true);
    try {
      await adminApi.cancelSubscription(subId);
      toast.success(t("user.cancelled"));
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("errors.cancelSubscription")
      );
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-sm text-muted-foreground">{t("errors.userNotFound")}</div>
    );
  }

  const totalUsage = user.usage.reduce(
    (sum, day) => sum + day.messages_sent,
    0
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/${locale}/admin/users`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {t("user.backToUsers")}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {user.full_name || user.email || user.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {user.email || "—"}
            {user.company_name ? ` · ${user.company_name}` : ""}
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gap-2"
          disabled={activating}
        >
          <CreditCard className="h-4 w-4" />
          {t("user.activatePlan")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("user.profile")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("user.phone")} value={user.phone || "—"} />
          <Field
            label={t("user.language")}
            value={user.language_preference || "—"}
          />
          <Field
            label={t("user.signedUp")}
            value={
              user.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "—"
            }
          />
          <Field
            label={t("user.lastSignIn")}
            value={
              user.last_sign_in_at
                ? new Date(user.last_sign_in_at).toLocaleDateString()
                : "—"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> {t("user.usage30d")}
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {totalUsage.toLocaleString()} {t("user.messages")}
          </span>
        </CardHeader>
        <CardContent>
          {user.usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("user.noUsage")}</p>
          ) : (
            <UsageBars usage={user.usage} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("user.subscriptionsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {user.subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("user.noSubscriptions")}
            </p>
          ) : (
            <div className="space-y-3">
              {user.subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={
                          sub.status === "active"
                            ? "bg-chart-3/20 text-chart-3"
                            : sub.status === "pending"
                              ? "bg-chart-4/20 text-chart-4"
                              : sub.status === "expired"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-muted text-muted-foreground"
                        }
                      >
                        {t(`status.${sub.status}`)}
                      </Badge>
                      <span className="text-sm text-foreground">
                        {sub.message_limit} {t("user.msgLimit")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {sub.current_usage} {t("user.used")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("user.created")}:{" "}
                      {sub.created_at
                        ? new Date(sub.created_at).toLocaleString()
                        : "—"}
                      {sub.expires_at && (
                        <>
                          {" · "}
                          {t("user.expires")}:{" "}
                          {new Date(sub.expires_at).toLocaleDateString()}
                        </>
                      )}
                    </p>
                    {sub.payment_reference && (
                      <p className="text-xs text-muted-foreground">
                        {t("user.payRef")}: {sub.payment_reference}{" "}
                        {sub.payment_method && `(${sub.payment_method})`}
                      </p>
                    )}
                  </div>
                  {(sub.status === "active" || sub.status === "pending") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelSub(sub.id)}
                      disabled={activating}
                      className="gap-1"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {t("user.cancel")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ActivatePlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        userId={user.id}
        userName={user.full_name || user.email || user.id.slice(0, 8)}
        onActivated={async () => {
          setDialogOpen(false);
          toast.success(t("user.activated"));
          await reload();
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

function UsageBars({
  usage,
}: {
  usage: { date: string; messages_sent: number }[];
}) {
  const max = Math.max(1, ...usage.map((u) => u.messages_sent));
  return (
    <div className="flex h-32 items-end gap-1">
      {usage.map((day) => (
        <div
          key={day.date}
          className="group relative flex-1"
          title={`${day.date}: ${day.messages_sent}`}
        >
          <div
            className="rounded-t bg-secondary/70 transition-all group-hover:bg-secondary"
            style={{
              height: `${Math.max(4, Math.round((day.messages_sent / max) * 100))}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

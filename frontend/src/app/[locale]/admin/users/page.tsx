"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { adminApi, type AdminUser } from "@/lib/api/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ChevronRight, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 50;

type StatusFilter = "all" | "none" | "pending" | "active" | "expired" | "cancelled";

export default function AdminUsersPage() {
  const t = useTranslations("Admin");
  const locale = useLocale();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const data = await adminApi.listUsers({
          search: search.trim() || undefined,
          sub_status: statusFilter === "all" ? undefined : statusFilter,
          limit: PAGE_SIZE,
          offset,
        });
        if (!cancelled) setUsers(data);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : t("errors.loadUsers")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, statusFilter, offset, t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {t("users.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setOffset(0);
              setSearch(e.target.value);
            }}
            placeholder={t("users.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setOffset(0);
            setStatusFilter(v as StatusFilter);
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("users.filterAll")}</SelectItem>
            <SelectItem value="none">{t("users.filterNone")}</SelectItem>
            <SelectItem value="pending">{t("status.pending")}</SelectItem>
            <SelectItem value="active">{t("status.active")}</SelectItem>
            <SelectItem value="expired">{t("status.expired")}</SelectItem>
            <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
          </SelectContent>
        </Select>
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
              <UsersIcon className="mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm">{t("users.empty")}</p>
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
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {u.full_name || u.email || u.id.slice(0, 8)}
                      </p>
                      {u.is_admin && (
                        <Badge variant="outline" className="text-xs">
                          Admin
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email || "—"}
                      {u.company_name ? ` · ${u.company_name}` : ""}
                    </p>
                  </div>
                  <div className="hidden text-end sm:block">
                    <p className="text-xs text-muted-foreground">
                      {t("users.messages30d", {
                        count: u.messages_last_30d,
                      })}
                    </p>
                  </div>
                  <div className="hidden md:block">
                    <SubscriptionBadge sub={u.subscription} />
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("users.showing", {
            from: users.length === 0 ? 0 : offset + 1,
            to: offset + users.length,
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {t("users.prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={users.length < PAGE_SIZE || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {t("users.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SubscriptionBadge({
  sub,
}: {
  sub: AdminUser["subscription"];
}) {
  const t = useTranslations("Admin.status");
  if (!sub) {
    return (
      <Badge variant="outline" className="text-xs">
        {t("none")}
      </Badge>
    );
  }
  const tone =
    sub.status === "active"
      ? "bg-chart-3/20 text-chart-3"
      : sub.status === "pending"
        ? "bg-chart-4/20 text-chart-4"
        : sub.status === "expired"
          ? "bg-destructive/20 text-destructive"
          : "bg-muted text-muted-foreground";
  return <Badge className={`${tone} text-xs`}>{t(sub.status)}</Badge>;
}

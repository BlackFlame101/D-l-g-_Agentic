"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { key: "overview", icon: LayoutDashboard, href: "/admin" },
  { key: "users", icon: Users, href: "/admin/users" },
  { key: "subscriptions", icon: CreditCard, href: "/admin/subscriptions" },
];

export function AdminSidebar({ collapsed, onToggle }: AdminSidebarProps) {
  const t = useTranslations("Admin");
  const tDash = useTranslations("Dashboard");
  const locale = useLocale();
  const pathname = usePathname();
  const { user } = useUser();

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Admin";

  function isActive(href: string) {
    const full = `/${locale}${href}`;
    if (href === "/admin") return pathname === full;
    return pathname.startsWith(full);
  }

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-e border-sidebar-border bg-sidebar transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        {collapsed ? (
          <Image
            src="/favicon.png"
            alt="D"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 object-contain"
          />
        ) : (
          <div className="flex items-center gap-2 overflow-hidden">
            <Image
              src="/favicon.png"
              alt="D"
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 object-contain"
            />
            <p className="truncate font-heading text-base font-bold text-sidebar-foreground">
              {t("title")}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const link = (
            <Link
              key={item.key}
              href={`/${locale}${item.href}`}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{t(`nav.${item.key}`)}</span>}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger render={<span className="block" />}>
                  {link}
                </TooltipTrigger>
                <TooltipContent side="inline-end" sideOffset={8}>
                  {t(`nav.${item.key}`)}
                </TooltipContent>
              </Tooltip>
            );
          }

          return link;
        })}

        <div className="my-3 h-px bg-sidebar-border/60" />

        <Link
          href={`/${locale}/dashboard`}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
        >
          <ArrowLeft className="h-5 w-5 shrink-0 rtl:rotate-180" />
          {!collapsed && <span className="truncate">{t("backToApp")}</span>}
        </Link>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
            {displayName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {displayName}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/60">
                {tDash("nav.dashboard")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          className="w-full"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}

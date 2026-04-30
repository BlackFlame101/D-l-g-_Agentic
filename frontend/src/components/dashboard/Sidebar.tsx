"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  Settings,
  CreditCard,
  Smartphone,
  BookOpen,
  Plug,
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

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { key: "dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { key: "agent", icon: Bot, href: "/dashboard/agent" },
  { key: "knowledge", icon: BookOpen, href: "/dashboard/knowledge" },
  { key: "whatsapp", icon: Smartphone, href: "/dashboard/whatsapp" },
  { key: "conversations", icon: MessageSquare, href: "/dashboard/conversations" },
  { key: "integrations", icon: Plug, href: "/dashboard/integrations" },
  { key: "billing", icon: CreditCard, href: "/dashboard/billing" },
  { key: "settings", icon: Settings, href: "/dashboard/settings" },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useTranslations("Dashboard");
  const tAdmin = useTranslations("Admin");
  const locale = useLocale();
  const pathname = usePathname();
  const { user } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      Promise.resolve().then(() => {
        if (!cancelled) setIsAdmin(false);
      });
      return () => {
        cancelled = true;
      };
    }
    const supabase = createClient();
    supabase
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(Boolean(data?.is_admin));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";

  function isActive(href: string) {
    const full = `/${locale}${href}`;
    if (href === "/dashboard") return pathname === full;
    return pathname.startsWith(full);
  }

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-e border-sidebar-border bg-sidebar transition-all duration-300",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
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
          <Image
            src="/logo.png"
            alt="Déléguè"
            width={160}
            height={40}
            className="h-10 w-auto object-contain"
          />
        )}
      </div>

      {/* Nav */}
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

        {isAdmin && (
          <>
            <div className="my-3 h-px bg-sidebar-border/60" />
            {(() => {
              const adminLink = (
                <Link
                  href={`/${locale}/admin`}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    pathname.startsWith(`/${locale}/admin`)
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">{tAdmin("title")}</span>}
                </Link>
              );
              if (collapsed) {
                return (
                  <Tooltip>
                    <TooltipTrigger render={<span className="block" />}>
                      {adminLink}
                    </TooltipTrigger>
                    <TooltipContent side="inline-end" sideOffset={8}>
                      {tAdmin("title")}
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return adminLink;
            })()}
          </>
        )}
      </nav>

      {/* Footer */}
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
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
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

"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Bell, LogOut, Settings, User, Menu } from "lucide-react";
import Link from "next/link";

interface TopbarProps {
  onMobileMenuToggle: () => void;
}

export function Topbar({ onMobileMenuToggle }: TopbarProps) {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();

  const displayName =
    user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(`/${locale}/auth/login`);
    router.refresh();
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onMobileMenuToggle}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            {t("greeting", { name: displayName.split(" ")[0] })}
          </h2>
          <p className="text-xs text-muted-foreground">{t("greetingSub")}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />

        <Button variant="ghost" size="icon-sm" className="relative">
          <Bell className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground transition-opacity hover:opacity-80">
              {displayName.charAt(0).toUpperCase()}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link href={`/${locale}/dashboard/settings`} />}
            >
              <Settings className="mr-2 h-4 w-4" />
              {t("nav.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<Link href={`/${locale}/dashboard/billing`} />}
            >
              <User className="mr-2 h-4 w-4" />
              {t("nav.billing")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

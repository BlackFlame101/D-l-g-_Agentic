"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Topbar } from "@/components/dashboard/Topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useUser } from "@/hooks/use-user";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auto-provision free trial on dashboard load
  useEffect(() => {
    if (user) {
      api.billing.getSubscription().catch(() => {
        // Silently fail, it's a background provisioning
      });
    }
  }, [user]);

  return (
    <TooltipProvider delay={0}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar — desktop */}
        <div className="hidden lg:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>

        {/* Sidebar — mobile */}
        <div
          className={cn(
            "fixed inset-y-0 start-0 z-50 lg:hidden transition-transform duration-300",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
          )}
        >
          <Sidebar collapsed={false} onToggle={() => setMobileMenuOpen(false)} />
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </TooltipProvider>
  );
}

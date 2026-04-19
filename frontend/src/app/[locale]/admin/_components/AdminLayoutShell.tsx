"use client";

import { useState } from "react";
import { AdminSidebar } from "@/components/dashboard/AdminSidebar";
import { Topbar } from "@/components/dashboard/Topbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <TooltipProvider delay={0}>
      <div className="flex h-screen overflow-hidden bg-background">
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        <div className="hidden lg:block">
          <AdminSidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </div>

        <div
          className={cn(
            "fixed inset-y-0 start-0 z-50 lg:hidden transition-transform duration-300",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
          )}
        >
          <AdminSidebar
            collapsed={false}
            onToggle={() => setMobileMenuOpen(false)}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </TooltipProvider>
  );
}

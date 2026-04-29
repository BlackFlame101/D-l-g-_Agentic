"use client";

import { useTranslations, useLocale } from "next-intl";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

// Shopify "S" logomark — shown inline next to the nav label
function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 340"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M223.9 51.4c-.2-1.8-1.8-2.8-3.1-2.9-1.3-.1-28.4-1.9-28.4-1.9s-19-18.9-20.7-20.6c-1.7-1.7-5.1-1.2-6.4-.8 0 0-3.6 1.1-9.3 2.9-5.5-15.9-15.3-30.5-32.5-30.5-.5 0-.9 0-1.4.1-4.8-6.3-10.8-9.1-16-9.1-39.6 0-58.6 49.5-64.5 74.6l-27.4 8.5c-8.5 2.7-8.8 2.9-9.9 10.9C3.3 89.5-22 291-22 291l188 33.1 101.8-24.9S224.1 53.2 223.9 51.4z"
        fill="#95BF47"
        transform="translate(22, 0)"
      />
      <path
        d="M192.4 46.6c-1.3-.1-28.4-1.9-28.4-1.9s-19-18.9-20.7-20.6c-.6-.6-1.5-1-2.3-.9L134.8 340l101.8-24.9s-36.4-265.7-36.6-267.5c-.2-1.8-1.8-2.8-3.1-2.9z"
        fill="#5E8E3E"
        transform="translate(22, 0)"
      />
      <path
        d="M123.4 104.5l-13.6 40.4s-11.8-6.3-26.3-6.3c-21.3 0-22.3 13.3-22.3 16.7 0 18.3 47.7 25.3 47.7 68.3 0 33.8-21.4 55.5-50.3 55.5C24.5 279.1 8 258.6 8 258.6l9.2-30.4s18.2 15.6 33.5 15.6c10 0 14.1-7.9 14.1-13.6 0-23.8-39.2-24.9-39.2-64.5 0-33.1 23.8-65.2 71.8-65.2 18.5 0 27.9 5 27.9 5z"
        fill="white"
        transform="translate(22, 20)"
      />
    </svg>
  );
}

const navLinks = [
  { href: "#features", key: "features" },
  { href: "#how-it-works", key: "howItWorks" },
  // Shopify is handled separately below so we can add the icon
  { href: "#pricing", key: "pricing" },
] as const;

export function Navbar() {
  const t = useTranslations("Navbar");
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-background/80 backdrop-blur-lg border-b border-border"
          : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <a href="#" className="text-xl font-bold text-foreground">
          Délégué
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("features")}
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("howItWorks")}
          </a>

          {/* Shopify tab with icon */}
          <a
            href="#shopify"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-[#95BF47]"
          >
            <ShopifyIcon className="h-3.5 w-3.5" />
            Shopify
          </a>

          <a
            href="#pricing"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("pricing")}
          </a>
        </div>

        {/* Desktop actions */}
        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            href={`/${locale}/auth/signup`}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("cta")}
          </Link>
        </div>

        {/* Mobile menu button */}
        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label={t("menu")}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-border bg-background md:hidden"
          >
            <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
              <a
                href="#features"
                onClick={() => setMobileOpen(false)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("features")}
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileOpen(false)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("howItWorks")}
              </a>

              {/* Shopify mobile item */}
              <a
                href="#shopify"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-[#95BF47]"
              >
                <ShopifyIcon className="h-3.5 w-3.5" />
                Shopify
              </a>

              <a
                href="#pricing"
                onClick={() => setMobileOpen(false)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("pricing")}
              </a>

              <Link
                href={`/${locale}/auth/signup`}
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("cta")}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
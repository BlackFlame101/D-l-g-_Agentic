"use client";

import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { Package, CheckCircle, ShoppingBag } from "lucide-react";

import { useTranslations } from "next-intl";

// Shopify "S" bag logomark as inline SVG
function ShopifyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 340"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Shopify"
    >
      <path
        d="M223.9 51.4c-.2-1.8-1.8-2.8-3.1-2.9-1.3-.1-28.4-1.9-28.4-1.9s-19-18.9-20.7-20.6c-1.7-1.7-5.1-1.2-6.4-.8 0 0-3.6 1.1-9.3 2.9-5.5-15.9-15.3-30.5-32.5-30.5-.5 0-.9 0-1.4.1-4.8-6.3-10.8-9.1-16-9.1-39.6 0-58.6 49.5-64.5 74.6l-27.4 8.5c-8.5 2.7-8.8 2.9-9.9 10.9C3.3 89.5-22 291 -22 291l188 33.1 101.8-24.9S224.1 53.2 223.9 51.4z"
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

const featureKeys = ["orderTracking", "orderConfirmation", "productExpertise"] as const;

export function ShopifyIntegration() {
  const t = useTranslations("Dashboard.shopify");
  
  return (
    <section id="shopify" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="text-center"
        >
          {/* Shopify pill badge — mirrors the hero badge style */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.4 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5"
          >
            <ShopifyIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-widest text-[#95BF47]">
              {t("badge")}
            </span>
          </motion.div>

          {/* Title — matches HowItWorks / Features heading scale */}
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
          >
            {t("titlePrefix")}{" "}
            <span className="text-[#95BF47]">Shopify</span>{" "}
            {t("titleSuffix")}
          </motion.h2>

          {/* Accent bar — uses --primary (gold) so it blends with the palette */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="mx-auto mt-4 h-0.5 w-14 rounded-full bg-primary"
          />
        </motion.div>

        {/* Feature cards — same card style as Features section */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {featureKeys.map((key) => {
            const Icon = key === "orderTracking" ? Package : key === "orderConfirmation" ? CheckCircle : ShoppingBag;
            return (
              <motion.div
                key={key}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="group rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:border-[#95BF47]/40 hover:shadow-lg hover:shadow-[#95BF47]/5"
              >
                {/* Icon — uses Shopify green to distinguish from other sections */}
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#95BF47]/10 text-[#95BF47] transition-colors duration-300 group-hover:bg-[#95BF47]/20">
                  <Icon className="h-6 w-6" strokeWidth={1.5} />
                </div>

                <h3 className="mt-5 text-base font-semibold text-foreground">
                  {t(`features.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`features.${key}.description`)}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

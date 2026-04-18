"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import Link from "next/link";

export function Hero() {
  const t = useTranslations("Hero");
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Gradient background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 start-1/4 h-[500px] w-[500px] rounded-full bg-secondary/10 blur-[120px]" />
        <div className="absolute -top-20 end-1/4 h-[400px] w-[400px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8"
      >
        {/* Badge */}
        <motion.div
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="mb-6 inline-flex items-center rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium tracking-wider text-muted-foreground"
        >
          {t("badge")}
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          transition={{ duration: 0.6 }}
          className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl"
        >
          {t("titleStart")}{" "}
          <span className="text-[#25D366]">{t("titleHighlight")}</span>{" "}
          {t("titleEnd")}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={fadeUp}
          transition={{ duration: 0.6 }}
          className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
        >
          {t("subtitle")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          transition={{ duration: 0.6 }}
          className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link
            href={`/${locale}/auth/signup`}
            className="inline-flex h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30"
          >
            {t("cta")}
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex h-12 items-center rounded-lg border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {t("demo")}
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}

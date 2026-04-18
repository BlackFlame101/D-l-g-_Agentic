"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { Check } from "lucide-react";
import Link from "next/link";

interface Plan {
  nameKey: string;
  descKey: string;
  priceKey: string;
  features: string[];
  ctaKey: string;
  highlighted?: boolean;
}

const plans: Plan[] = [
  {
    nameKey: "starterName",
    descKey: "starterDesc",
    priceKey: "starterPrice",
    features: ["starterFeature1", "starterFeature2", "starterFeature3"],
    ctaKey: "starterCta",
  },
  {
    nameKey: "proName",
    descKey: "proDesc",
    priceKey: "proPrice",
    features: ["proFeature1", "proFeature2", "proFeature3", "proFeature4"],
    ctaKey: "proCta",
    highlighted: true,
  },
  {
    nameKey: "businessName",
    descKey: "businessDesc",
    priceKey: "businessPrice",
    features: ["businessFeature1", "businessFeature2", "businessFeature3"],
    ctaKey: "businessCta",
  },
];

export function Pricing() {
  const t = useTranslations("Pricing");
  const locale = useLocale();

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="text-center"
        >
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="text-3xl font-bold text-foreground sm:text-4xl"
          >
            {t("title")}
          </motion.h2>
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="mx-auto mt-4 max-w-xl text-base text-muted-foreground"
          >
            {t("subtitle")}
          </motion.p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mt-14 grid gap-6 lg:grid-cols-3"
        >
          {plans.map((plan) => (
            <motion.div
              key={plan.nameKey}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className={`relative flex flex-col rounded-2xl border p-6 sm:p-8 transition-all ${
                plan.highlighted
                  ? "border-primary bg-card shadow-xl shadow-primary/10 scale-[1.02] lg:scale-105"
                  : "border-border bg-card hover:border-border/80"
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                  {t("popular")}
                </span>
              )}

              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {t(plan.nameKey)}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(plan.descKey)}</p>
              </div>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-foreground">
                  {t(plan.priceKey)}
                </span>
                <span className="text-sm text-muted-foreground">{t("perMonth")}</span>
              </div>

              <ul className="mt-8 flex-1 space-y-3">
                {plan.features.map((fKey) => (
                  <li key={fKey} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-sm text-muted-foreground">{t(fKey)}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/${locale}/auth/signup`}
                className={`mt-8 inline-flex h-11 items-center justify-center rounded-lg text-sm font-semibold transition-all ${
                  plan.highlighted
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
                    : "border border-border text-foreground hover:bg-accent"
                }`}
              >
                {t(plan.ctaKey)}
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

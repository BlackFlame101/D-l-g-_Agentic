"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { Globe2, Clock, BarChart3 } from "lucide-react";

const features = [
  { key: "feature1", icon: Globe2 },
  { key: "feature2", icon: Clock },
  { key: "feature3", icon: BarChart3 },
] as const;

export function Features() {
  const t = useTranslations("Features");

  return (
    <section id="features" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid gap-6 lg:grid-cols-2 lg:gap-12"
        >
          <div>
            <motion.span
              variants={fadeUp}
              transition={{ duration: 0.4 }}
              className="text-xs font-semibold uppercase tracking-widest text-secondary"
            >
              {t("kicker")}
            </motion.span>
            <motion.h2
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              className="mt-3 text-3xl font-bold text-foreground sm:text-4xl"
            >
              {t("titleStart")}{" "}
              <span className="text-secondary">{t("titleHighlight")}</span>
            </motion.h2>
          </div>
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className="max-w-lg self-end text-base leading-relaxed text-muted-foreground lg:text-lg"
          >
            {t("description")}
          </motion.p>
        </motion.div>

        {/* Cards */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <motion.div
                key={feat.key}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/10 text-secondary transition-colors group-hover:bg-secondary/20">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-foreground">
                  {t(`${feat.key}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`${feat.key}Desc`)}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

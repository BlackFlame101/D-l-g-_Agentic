"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { QrCode, MessageSquare, Users, ArrowRight } from "lucide-react";

const steps = [
  { key: "step1", icon: QrCode, gradient: "from-[#7B6EF6] to-[#A78BFA]" },
  { key: "step2", icon: MessageSquare, gradient: "from-[#F5C842] to-[#FBBF24]" },
  { key: "step3", icon: Users, gradient: "from-[#25D366] to-[#34D399]" },
] as const;

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {t("title")}
          </h2>
        </motion.div>

        {/* Steps */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="relative mt-20"
        >
          {/* Connecting line (desktop only) */}
          <div className="absolute top-16 hidden h-px w-full lg:block">
            <div className="mx-auto h-full max-w-3xl border-t border-dashed border-border" />
          </div>

          <div className="grid gap-6 sm:gap-8 lg:grid-cols-3 lg:gap-6">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.key}
                  variants={fadeUp}
                  transition={{ duration: 0.5 }}
                  className="group relative"
                >
                  <div className="relative flex flex-col items-center rounded-2xl border border-border bg-card p-8 text-center transition-all duration-300 hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/5 lg:p-10">
                    {/* Number badge */}
                    <div className="absolute -top-5 flex h-10 w-10 items-center justify-center rounded-full bg-background ring-4 ring-background">
                      <span className={`flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ${step.gradient} text-sm font-bold text-white`}>
                        {i + 1}
                      </span>
                    </div>

                    {/* Icon */}
                    <div className={`mt-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${step.gradient} shadow-lg`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>

                    {/* Content */}
                    <h3 className="mt-6 text-lg font-semibold text-foreground">
                      {t(`${step.key}Title`)}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {t(`${step.key}Desc`)}
                    </p>
                  </div>

                  {/* Arrow connector (visible between cards on mobile/tablet) */}
                  {i < steps.length - 1 && (
                    <div className="flex justify-center py-3 text-border lg:hidden">
                      <ArrowRight className="h-5 w-5 rotate-90" />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

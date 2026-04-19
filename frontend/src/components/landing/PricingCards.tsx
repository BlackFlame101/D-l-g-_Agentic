"use client";

import { motion } from "framer-motion";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { Check } from "lucide-react";

export interface PricingPlan {
  id: string;
  name: string;
  displayName: string;
  description: string;
  priceMad: number;
  messageLimit: number;
  features: string[];
  isRecommended: boolean;
}

interface Labels {
  popular: string;
  perMonth: string;
  ctaContact: string;
  messageSuffix: string;
  noPlans: string;
  contactMessage: string;
}

export function PricingCards({
  plans,
  salesPhone,
  locale,
  labels,
}: {
  plans: PricingPlan[];
  salesPhone: string;
  locale: string;
  labels: Labels;
}) {
  if (plans.length === 0) {
    return (
      <p className="mt-14 text-center text-sm text-muted-foreground">
        {labels.noPlans}
      </p>
    );
  }

  const recommendedIdx = plans.findIndex((p) => p.isRecommended);
  const highlightIdx =
    recommendedIdx >= 0 ? recommendedIdx : Math.min(1, plans.length - 1);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      className="mt-14 grid gap-6 lg:grid-cols-3"
    >
      {plans.map((plan, idx) => {
        const highlighted = idx === highlightIdx;
        const message = labels.contactMessage.replace(
          "{plan}",
          plan.displayName
        );
        const ctaHref = salesPhone
          ? `https://wa.me/${salesPhone}?text=${encodeURIComponent(message)}`
          : `/${locale}/auth/signup`;

        return (
          <motion.div
            key={plan.id}
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            className={`relative flex flex-col rounded-2xl border p-6 sm:p-8 transition-all ${
              highlighted
                ? "border-primary bg-card shadow-xl shadow-primary/10 scale-[1.02] lg:scale-105"
                : "border-border bg-card hover:border-border/80"
            }`}
          >
            {highlighted && (
              <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                {labels.popular}
              </span>
            )}

            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {plan.displayName}
              </h3>
              {plan.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.description}
                </p>
              )}
            </div>

            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-foreground">
                {plan.priceMad}
              </span>
              <span className="text-sm text-muted-foreground">
                {labels.perMonth}
              </span>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {plan.messageLimit.toLocaleString()} {labels.messageSuffix}
            </p>

            <ul className="mt-6 flex-1 space-y-3">
              {plan.features.map((feature, i) => (
                <li key={`${plan.id}-${i}`} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm text-muted-foreground">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            <a
              href={ctaHref}
              target={salesPhone ? "_blank" : undefined}
              rel={salesPhone ? "noopener noreferrer" : undefined}
              className={`mt-8 inline-flex h-11 items-center justify-center rounded-lg text-sm font-semibold transition-all ${
                highlighted
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
                  : "border border-border text-foreground hover:bg-accent"
              }`}
            >
              {labels.ctaContact}
            </a>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

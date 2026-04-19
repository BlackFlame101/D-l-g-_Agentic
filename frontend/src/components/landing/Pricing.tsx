import { createClient } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { PricingCards, type PricingPlan } from "./PricingCards";

export const revalidate = 300;

export async function Pricing() {
  const t = await getTranslations("Pricing");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data } = await supabase
    .from("plans")
    .select("id,name,display_name,description,price_mad,message_limit,features,is_recommended")
    .eq("is_active", true)
    .order("price_mad", { ascending: true });

  const plans: PricingPlan[] = (data || []).map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.display_name,
    description: p.description ?? "",
    priceMad: Number(p.price_mad),
    messageLimit: p.message_limit,
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
    isRecommended: Boolean(p.is_recommended),
  }));

  const salesPhone =
    process.env.NEXT_PUBLIC_SALES_WHATSAPP?.replace(/\D/g, "") || "";

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        <PricingCards
          plans={plans}
          salesPhone={salesPhone}
          locale={locale}
          labels={{
            popular: t("popular"),
            perMonth: t("perMonth"),
            ctaContact: t("ctaContact"),
            messageSuffix: t("messageSuffix"),
            noPlans: t("noPlans"),
            contactMessage: t("contactMessage"),
          }}
        />
      </div>
    </section>
  );
}

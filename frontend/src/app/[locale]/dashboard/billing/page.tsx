"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CreditCard,
  Calendar,
  MessageSquare,
  Building2,
  Phone,
  Copy,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RIB =
  process.env.NEXT_PUBLIC_PAYMENT_RIB || "XXX XXXX XXXX XXXX XXXX XX";
const CASHPLUS_PHONE =
  process.env.NEXT_PUBLIC_PAYMENT_CASHPLUS || "+212 6XX XXX XXX";
const BENEFICIARY =
  process.env.NEXT_PUBLIC_PAYMENT_BENEFICIARY || "Déléguè SARL";
const SALES_WHATSAPP =
  (process.env.NEXT_PUBLIC_SALES_WHATSAPP || "").replace(/\D/g, "");

interface Subscription {
  id: string;
  status: string;
  message_limit: number;
  current_usage: number;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
  expires_at: string | null;
}

interface Plan {
  id: string;
  name: string;
  display_name?: string;
  message_limit: number;
  price_mad: number;
  features: string[];
}

export default function BillingPage() {
  const t = useTranslations("Dashboard");
  const { user } = useUser();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [requestedPlanId, setRequestedPlanId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadBilling();
  }, [user]);

  async function loadBilling() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*, plans(*)")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sub) {
        setSubscription(sub);
        if (sub.plans) setPlan(sub.plans);
      }
      const { data: plans } = await supabase
        .from("plans")
        .select("id,name,display_name,message_limit,price_mad,features")
        .eq("is_active", true)
        .order("price_mad", { ascending: true });
      const safePlans = (plans || []) as Plan[];
      setAvailablePlans(safePlans);
      if (safePlans.length > 0) {
        setRequestedPlanId(safePlans[0].id);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
    toast.success(t("billing.copied"));
  }

  const usagePercent = subscription
    ? Math.min(
        Math.round(
          (subscription.current_usage / subscription.message_limit) * 100
        ),
        100
      )
    : 0;

  const daysUntilExpiry = subscription?.expires_at
    ? Math.ceil(
        (new Date(subscription.expires_at).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;
  const expiringSoon =
    subscription?.status === "active" &&
    daysUntilExpiry !== null &&
    daysUntilExpiry >= 0 &&
    daysUntilExpiry <= 3;

  const contactMessage = encodeURIComponent(
    plan
      ? t("billing.whatsappRenewMessage", { plan: plan.name })
      : t("billing.whatsappContactMessage")
  );
  const whatsappHref = SALES_WHATSAPP
    ? `https://wa.me/${SALES_WHATSAPP}?text=${contactMessage}`
    : "#";
  const requestedPlan =
    availablePlans.find((p) => p.id === requestedPlanId) || availablePlans[0];
  const activationRequestHref = SALES_WHATSAPP
    ? `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(
        `Hello, I want to activate a subscription for my account.\nUser ID: ${user?.id}\nRequested plan: ${
          requestedPlan?.display_name || requestedPlan?.name || "N/A"
        }\nMonthly price: ${requestedPlan?.price_mad ?? "N/A"} MAD\nMessage limit: ${
          requestedPlan?.message_limit ?? "N/A"
        }`
      )}`
    : "#";

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">
          {t("billing.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("billing.description")}
        </p>
      </div>

      {expiringSoon && (
        <div className="flex items-start gap-3 rounded-lg border border-chart-4/40 bg-chart-4/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-chart-4" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">
              {t("billing.expiringSoonTitle", { days: daysUntilExpiry! })}
            </p>
            <p className="text-muted-foreground">
              {t("billing.expiringSoonDesc")}
            </p>
          </div>
          {SALES_WHATSAPP && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-chart-4 px-3 text-xs font-semibold text-white hover:bg-chart-4/90"
            >
              <Phone className="h-3.5 w-3.5" />
              {t("billing.renewNow")}
            </a>
          )}
        </div>
      )}

      {/* Current plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-secondary" />
            {t("billing.currentPlan")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-heading text-lg font-bold text-foreground">
                    {plan?.name || t("billing.standardPlan")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {plan
                      ? `${plan.price_mad} MAD/${t("billing.perMonth")}`
                      : ""}
                  </p>
                </div>
                <Badge
                  className={
                    subscription.status === "active"
                      ? "bg-chart-3/20 text-chart-3"
                      : "bg-chart-1/20 text-chart-1"
                  }
                >
                  {subscription.status === "active"
                    ? t("billing.active")
                    : subscription.status}
                </Badge>
              </div>
              {subscription.expires_at && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {t("billing.expiresOn")}{" "}
                  {new Date(subscription.expires_at).toLocaleDateString()}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-left">
                <p className="text-sm font-medium text-foreground">
                  No active subscription
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pick a plan and send an activation request. An admin will activate
                  it from the dashboard.
                </p>
                {availablePlans.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-foreground">Requested plan</p>
                    <Select
                      value={requestedPlanId}
                      onValueChange={(value) => setRequestedPlanId(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePlans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name || p.name} - {p.price_mad} MAD -{" "}
                            {p.message_limit} msg
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("billing.noPlan")}
              </p>
              {SALES_WHATSAPP ? (
                <a
                  href={activationRequestHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Phone className="h-4 w-4" />
                  Request activation on WhatsApp
                </a>
              ) : (
                <Button className="mt-3 gap-2" disabled>
                  <Phone className="h-4 w-4" />
                  {t("billing.contactWhatsApp")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-secondary" />
              {t("billing.usage")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("billing.messagesUsed")}
              </span>
              <span className="font-medium text-foreground">
                {subscription.current_usage} / {subscription.message_limit}
              </span>
            </div>
            <Progress value={usagePercent} className="h-3" />
            <p className="text-xs text-muted-foreground">
              {usagePercent}% {t("billing.ofQuota")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Payment instructions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("billing.paymentMethods")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("billing.paymentInstructions")}
          </p>

          <div className="space-y-3">
            <PaymentMethod
              icon={<Building2 className="h-5 w-5" />}
              title={t("billing.bankTransfer")}
              details={[
                { label: "RIB", value: RIB },
                {
                  label: t("billing.beneficiary"),
                  value: BENEFICIARY,
                },
              ]}
              copied={copied}
              onCopy={copyToClipboard}
            />
            <PaymentMethod
              icon={<Phone className="h-5 w-5" />}
              title="CashPlus"
              details={[
                {
                  label: t("billing.transferTo"),
                  value: CASHPLUS_PHONE,
                },
              ]}
              copied={copied}
              onCopy={copyToClipboard}
            />
          </div>

          {SALES_WHATSAPP && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent"
            >
              <Phone className="h-4 w-4" />
              {t("billing.contactWhatsApp")}
            </a>
          )}

          <div className="rounded-lg bg-primary/10 p-4 text-sm text-foreground">
            <p className="font-medium">{t("billing.afterPayment")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("billing.afterPaymentDesc")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentMethod({
  icon,
  title,
  details,
  copied,
  onCopy,
}: {
  icon: React.ReactNode;
  title: string;
  details: { label: string; value: string }[];
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-3 space-y-2">
        {details.map((d) => (
          <div
            key={d.label}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-muted-foreground">{d.label}:</span>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-0.5 text-xs text-foreground">
                {d.value}
              </code>
              <button
                onClick={() => onCopy(d.value, d.label)}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied === d.label ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-chart-3" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

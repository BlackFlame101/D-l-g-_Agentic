"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi, type AdminPlan } from "@/lib/api/admin";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  onActivated: () => void | Promise<void>;
}

function defaultExpiry(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function ActivatePlanDialog({
  open,
  onOpenChange,
  userId,
  userName,
  onActivated,
}: Props) {
  const t = useTranslations("Admin");

  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<
    "bank_transfer" | "cashplus" | "cash"
  >("bank_transfer");
  const [reference, setReference] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await adminApi.listPlans();
        if (cancelled) return;
        setPlans(data);
        if (data.length && !planId) setPlanId(data[0].id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("errors.loadPlans"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setSubmitting(true);
    try {
      await adminApi.createSubscription({
        user_id: userId,
        plan_id: planId,
        payment_method: paymentMethod,
        payment_reference: reference.trim() || undefined,
        expires_at: new Date(`${expiresAt}T23:59:59Z`).toISOString(),
      });
      await onActivated();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("errors.activateSubscription")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("activate.title")}</DialogTitle>
          <DialogDescription>
            {t("activate.description", { name: userName })}
          </DialogDescription>
        </DialogHeader>

        <form id="activate-plan-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan">{t("activate.plan")}</Label>
            {plans === null ? (
              <Skeleton className="h-10 w-full" />
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("activate.noPlans")}
              </p>
            ) : (
              <Select value={planId} onValueChange={(v) => setPlanId(v ?? "")}>
                <SelectTrigger id="plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name} — {p.message_limit} msg ·{" "}
                      {p.price_mad} MAD
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="method">{t("activate.method")}</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) =>
                setPaymentMethod(v as "bank_transfer" | "cashplus" | "cash")
              }
            >
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">
                  {t("activate.bankTransfer")}
                </SelectItem>
                <SelectItem value="cashplus">
                  {t("activate.cashplus")}
                </SelectItem>
                <SelectItem value="cash">{t("activate.cash")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">
              {t("activate.reference")}{" "}
              <span className="text-muted-foreground">
                ({t("activate.optional")})
              </span>
            </Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("activate.referencePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expires">{t("activate.expiresAt")}</Label>
            <Input
              id="expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              required
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("activate.cancel")}
          </Button>
          <Button
            type="submit"
            form="activate-plan-form"
            disabled={submitting || !planId || plans?.length === 0}
          >
            {submitting ? t("activate.submitting") : t("activate.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

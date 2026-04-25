"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { integrationsApi, type ShopifyIntegration } from "@/lib/api";
import { ExternalLink, Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const t = useTranslations("Dashboard");
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [shopDomain, setShopDomain] = useState("");

  useEffect(() => {
    // Show success toast if redirected back from Shopify OAuth
    if (searchParams.get("shopify") === "connected") {
      toast.success(t("integrations.connected"));
      // Clean up URL param without re-render loop
      window.history.replaceState({}, "", window.location.pathname);
    }
    loadIntegration();
  }, []);

  async function loadIntegration() {
    setLoading(true);
    try {
      const row = await integrationsApi.getShopify();
      setIntegration(row);
      if (row.connected) {
        setShopDomain(row.store_url || "");
      }
    } catch (err: any) {
      toast.error(err.message || t("errors.loadIntegrations"));
    } finally {
      setLoading(false);
    }
  }

  function handleOAuthConnect() {
    if (!shopDomain.trim()) {
      toast.error("Enter your Shopify store domain first.");
      return;
    }
    setConnecting(true);
    // Redirects browser to Shopify — no async needed
    integrationsApi.startShopifyOAuth(shopDomain.trim());
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await integrationsApi.disconnectShopify();
      setIntegration({
        type: "shopify",
        store_url: "",
        token_saved: false,
        is_active: false,
        feature_enabled: false,
        connected: false,
      });
      setShopDomain("");
      toast.success(t("integrations.disconnected"));
    } catch (err: any) {
      toast.error(err.message || t("errors.disconnectIntegration"));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-8 w-40" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const connected = Boolean(integration?.connected);
  const active = connected && integration?.is_active && integration?.feature_enabled;
  const pending = connected && integration?.is_active && !integration?.feature_enabled;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">
          {t("integrations.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("integrations.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-secondary" />
            Shopify
            {active && (
              <Badge className="bg-chart-3/20 text-chart-3">{t("integrations.active")}</Badge>
            )}
            {pending && (
              <Badge className="bg-chart-4/20 text-chart-4">{t("integrations.pending")}</Badge>
            )}
            {!connected && (
              <Badge variant="outline">{t("integrations.notConnected")}</Badge>
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {connected ? (
            // ── Connected state ──────────────────────────────────────────
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
                <p className="text-sm font-medium text-foreground">{integration?.store_url}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("integrations.tokenHint")}
                </p>
              </div>

              {pending && (
                <p className="rounded-md border border-chart-4/40 bg-chart-4/10 p-3 text-sm text-foreground">
                  {t("integrations.pendingHelp")}
                </p>
              )}

              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="gap-2"
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t("integrations.disconnect")}
              </Button>
            </div>
          ) : (
            // ── Not connected state ──────────────────────────────────────
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="shopDomain">{t("integrations.storeUrl")}</Label>
                <Input
                  id="shopDomain"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="mystore.myshopify.com"
                  onKeyDown={(e) => e.key === "Enter" && handleOAuthConnect()}
                />
                <p className="text-xs text-muted-foreground">
                  Just your store domain — no API keys needed.
                </p>
              </div>

              <Button
                onClick={handleOAuthConnect}
                disabled={connecting}
                className="gap-2"
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                {t("integrations.connect")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
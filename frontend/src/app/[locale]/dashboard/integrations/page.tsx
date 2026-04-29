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
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const t = useTranslations("Dashboard");
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    if (searchParams.get("shopify") === "connected") {
      toast.success(t("integrations.connected"));
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

  async function handleOAuthConnect() {
    if (!shopDomain.trim()) {
      toast.error("Enter your Shopify store domain first.");
      return;
    }
    setConnecting(true);
    try {
      await integrationsApi.startShopifyOAuth(shopDomain.trim());
    } catch (err: any) {
      toast.error(err.message || "Failed to start Shopify connection.");
      setConnecting(false);
    }
  }

  async function handleManualConnect() {
    if (!shopDomain.trim()) {
      toast.error("Enter your Shopify store domain.");
      return;
    }
    if (!accessToken.trim()) {
      toast.error("Enter your Admin API access token.");
      return;
    }
    setSavingManual(true);
    try {
      await integrationsApi.connectShopify(shopDomain.trim(), accessToken.trim());
      toast.success("Shopify connected successfully!");
      await loadIntegration();
      setAccessToken("");
      setShowManual(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to connect Shopify.");
    } finally {
      setSavingManual(false);
    }
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
            <div className="space-y-4">
              {/* Store domain input — shared by both methods */}
              <div className="space-y-2">
                <Label htmlFor="shopDomain">{t("integrations.storeUrl")}</Label>
                <Input
                  id="shopDomain"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="mystore.myshopify.com"
                  onKeyDown={(e) => e.key === "Enter" && !showManual && handleOAuthConnect()}
                />
              </div>

              {/* OAuth connect button */}
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

              {/* Manual token toggle */}
              <button
                type="button"
                onClick={() => setShowManual((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showManual ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Connect with API token instead
              </button>

              {showManual && (
                <div className="rounded-md border border-border bg-muted/30 p-4 space-y-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Connect using a custom app token</p>
                    <p className="text-xs text-muted-foreground">
                      Use this if the standard connect button doesn't work for your store.
                    </p>
                  </div>

                  {/* Step-by-step guide */}
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Go to your Shopify Admin → Settings → Apps and sales channels</li>
                    <li>Click <strong className="text-foreground">Develop apps</strong> → <strong className="text-foreground">Create an app</strong></li>
                    <li>Give it any name, then click <strong className="text-foreground">Configure Admin API scopes</strong></li>
                    <li>Enable: <code className="bg-muted px-1 rounded">read_products</code>, <code className="bg-muted px-1 rounded">read_orders</code>, <code className="bg-muted px-1 rounded">read_customers</code></li>
                    <li>Click <strong className="text-foreground">Save</strong> → then <strong className="text-foreground">Install app</strong></li>
                    <li>Copy the <strong className="text-foreground">Admin API access token</strong> and paste it below</li>
                  </ol>

                  <div className="space-y-2">
                    <Label htmlFor="accessToken">Admin API Access Token</Label>
                    <Input
                      id="accessToken"
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
                    />
                  </div>

                  <Button
                    onClick={handleManualConnect}
                    disabled={savingManual}
                    className="gap-2 w-full"
                  >
                    {savingManual ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4" />
                    )}
                    Save & Connect
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
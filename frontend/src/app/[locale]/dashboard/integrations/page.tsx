"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { integrationsApi, type ShopifyIntegration } from "@/lib/api";
import { Link2, Loader2, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TOKEN_MASK = "••••••••";

export default function IntegrationsPage() {
  const t = useTranslations("Dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [storeUrl, setStoreUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    loadIntegration();
  }, []);

  async function loadIntegration() {
    setLoading(true);
    try {
      const row = await integrationsApi.getShopify();
      setIntegration(row);
      if (row.connected) {
        setStoreUrl(row.store_url || "");
        setAccessToken("");
      }
    } catch (err: any) {
      toast.error(err.message || t("errors.loadIntegrations"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!storeUrl.trim() || !accessToken.trim()) {
      toast.error(t("errors.connectIntegration"));
      return;
    }
    setSaving(true);
    try {
      const saved = await integrationsApi.connectShopify({
        store_url: storeUrl,
        access_token: accessToken,
      });
      setIntegration(saved);
      setStoreUrl(saved.store_url || storeUrl);
      setAccessToken("");
      toast.success(t("integrations.connected"));
    } catch (err: any) {
      toast.error(err.message || t("errors.connectIntegration"));
    } finally {
      setSaving(false);
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
      setStoreUrl("");
      setAccessToken("");
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
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
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
            {!connected && <Badge variant="outline">{t("integrations.notConnected")}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shopifyStoreUrl">{t("integrations.storeUrl")}</Label>
            <Input
              id="shopifyStoreUrl"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              placeholder="mystore.myshopify.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shopifyAccessToken">{t("integrations.accessToken")}</Label>
            <Input
              id="shopifyAccessToken"
              type="password"
              value={connected && !accessToken ? TOKEN_MASK : accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="shpat_..."
            />
            <p className="text-xs text-muted-foreground">{t("integrations.tokenHint")}</p>
          </div>

          {pending && (
            <p className="rounded-md border border-chart-4/40 bg-chart-4/10 p-3 text-sm text-foreground">
              {t("integrations.pendingHelp")}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {connected ? t("integrations.update") : t("integrations.connect")}
            </Button>
            {connected && (
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
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import {
  getWhatsAppQrWsUrl,
  getWhatsAppStatus,
  disconnectWhatsApp,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Smartphone,
  QrCode,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

type ConnectionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected";

export default function WhatsAppPage() {
  const t = useTranslations("Dashboard");
  const { user } = useUser();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;
    checkStatus();
    return () => {
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user]);

  async function checkStatus() {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getWhatsAppStatus(user.id);
      setStatus(data.status as ConnectionStatus);
      if (data.phone_number) setPhoneNumber(data.phone_number);
    } catch {
      setStatus("disconnected");
    } finally {
      setLoading(false);
    }
  }

  const connectQr = useCallback(() => {
    if (!user) return;
    setQrCode(null);
    setStatus("qr_pending");

    wsRef.current?.close();
    const ws = new WebSocket(getWhatsAppQrWsUrl(user.id));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.qr) {
          setQrCode(data.qr);
          setStatus("qr_pending");
        }
        if (data.status === "connected") {
          setStatus("connected");
          setQrCode(null);
          if (data.phone_number) setPhoneNumber(data.phone_number);
          ws.close();
          toast.success(t("whatsapp.connected"));
        }
        if (data.status === "connecting") {
          setStatus("connecting");
        }
      } catch {
        // non-JSON message, ignore
      }
    };

    ws.onerror = () => {
      toast.error(t("whatsapp.wsError"));
    };

    ws.onclose = () => {
      // start polling for status after WS closes
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const data = await getWhatsAppStatus(user.id);
          if (data.status === "connected") {
            setStatus("connected");
            if (data.phone_number) setPhoneNumber(data.phone_number);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          // keep polling
        }
      }, 3000);
    };
  }, [user, t]);

  async function handleDisconnect() {
    if (!user) return;
    setDisconnecting(true);
    try {
      await disconnectWhatsApp(user.id);
      setStatus("disconnected");
      setPhoneNumber(null);
      setQrCode(null);
      toast.success(t("whatsapp.disconnected"));
    } catch (err: any) {
      toast.error(err.message || t("errors.disconnectFailed"));
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">
          {t("whatsapp.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("whatsapp.description")}
        </p>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-secondary" />
            {t("whatsapp.statusTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full ${
                status === "connected" ? "bg-chart-3/20" : "bg-muted"
              }`}
            >
              {status === "connected" ? (
                <Wifi className="h-6 w-6 text-chart-3" />
              ) : (
                <WifiOff className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t(`whatsapp.status_${status}`)}
                </span>
                <StatusBadge status={status} />
              </div>
              {phoneNumber && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {phoneNumber}
                </p>
              )}
            </div>
            {status === "connected" ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="gap-1"
              >
                {disconnecting && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {t("whatsapp.disconnect")}
              </Button>
            ) : (
              <Button size="sm" onClick={connectQr} className="gap-1">
                <QrCode className="h-4 w-4" />
                {t("whatsapp.scanQr")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* QR Code display */}
      {(status === "qr_pending" || status === "connecting") && (
        <Card>
          <CardContent className="flex flex-col items-center py-10">
            {qrCode ? (
              <>
                <div className="rounded-2xl bg-white p-4">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
                    alt="WhatsApp QR Code"
                    width={256}
                    height={256}
                    className="h-64 w-64"
                  />
                </div>
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {t("whatsapp.qrInstructions")}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={connectQr}
                  className="mt-2 gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t("whatsapp.refreshQr")}
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center">
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {t("whatsapp.waitingQr")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("whatsapp.howToConnect")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
            <li>{t("whatsapp.step1")}</li>
            <li>{t("whatsapp.step2")}</li>
            <li>{t("whatsapp.step3")}</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <Badge className="bg-chart-3/20 text-chart-3">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Connected
      </Badge>
    );
  }
  if (status === "connecting" || status === "qr_pending") {
    return (
      <Badge className="bg-chart-1/20 text-chart-1">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Connecting
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <WifiOff className="mr-1 h-3 w-3" />
      Offline
    </Badge>
  );
}

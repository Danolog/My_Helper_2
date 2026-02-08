"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Key,
  Webhook,
  Tag,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StripeStatus = {
  configured: boolean;
  connected: boolean;
  publishableKeyConfigured: boolean;
  webhookConfigured: boolean;
  pricesConfigured: boolean;
  accountName?: string;
  accountId?: string;
  liveMode?: boolean;
  error?: string;
};

function StatusIcon({ ok }: { ok: boolean }) {
  if (ok) {
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  }
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function ConfigItem({
  icon: Icon,
  label,
  description,
  configured,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  configured: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border">
      <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">{label}</span>
          <Badge
            variant={configured ? "default" : "outline"}
            className={
              configured
                ? "bg-green-100 text-green-800 hover:bg-green-100 border-green-200"
                : "bg-yellow-50 text-yellow-700 hover:bg-yellow-50 border-yellow-200"
            }
          >
            {configured ? "Skonfigurowany" : "Nieskonfigurowany"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

export default function PaymentSettingsPage() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/stripe/status");
      const data = await res.json();
      if (data.success && data.data) {
        setStatus(data.data);
      } else if (data.data) {
        setStatus(data.data);
      }
    } catch {
      setStatus({
        configured: false,
        connected: false,
        publishableKeyConfigured: false,
        webhookConfigured: false,
        pricesConfigured: false,
        error: "Nie udalo sie polaczyc z API",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStatus();
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Ustawienia platnosci</h1>
          <p className="text-muted-foreground">
            Konfiguracja integracji ze Stripe i ustawienia platnosci
          </p>
        </div>
      </div>

      {/* Connection Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-xl">Status polaczenia Stripe</CardTitle>
                <CardDescription>
                  Informacje o polaczeniu z Stripe API
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Odswiez
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Sprawdzanie polaczenia...</span>
            </div>
          ) : status ? (
            <div className="space-y-6">
              {/* Main connection status */}
              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                <StatusIcon ok={status.connected} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">
                      {status.connected ? "Polaczono" : "Niepolaczono"}
                    </span>
                    {status.connected ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                        Aktywne
                      </Badge>
                    ) : status.configured ? (
                      <Badge variant="destructive">Blad polaczenia</Badge>
                    ) : (
                      <Badge variant="outline">Nieskonfigurowany</Badge>
                    )}
                  </div>
                  {status.connected && status.accountId && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Konto: {status.accountName || status.accountId}
                      {status.liveMode !== undefined && (
                        <span className="ml-2">
                          ({status.liveMode ? "Tryb produkcyjny" : "Tryb testowy"})
                        </span>
                      )}
                    </p>
                  )}
                  {status.error && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{status.error}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Configuration checklist */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                  Konfiguracja
                </h3>
                <ConfigItem
                  icon={Key}
                  label="Klucz tajny (Secret Key)"
                  description="STRIPE_SECRET_KEY - wymagany do komunikacji z API Stripe"
                  configured={status.configured}
                />
                <ConfigItem
                  icon={Shield}
                  label="Klucz publiczny (Publishable Key)"
                  description="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY - wymagany do Stripe Elements w przegladarce"
                  configured={status.publishableKeyConfigured}
                />
                <ConfigItem
                  icon={Webhook}
                  label="Webhook Secret"
                  description="STRIPE_WEBHOOK_SECRET - wymagany do odbierania zdarzen ze Stripe"
                  configured={status.webhookConfigured}
                />
                <ConfigItem
                  icon={Tag}
                  label="ID cennikow subskrypcji"
                  description="STRIPE_PRICE_BASIC i STRIPE_PRICE_PRO - wymagane do planow subskrypcyjnych"
                  configured={status.pricesConfigured}
                />
              </div>

              {/* Connection test summary */}
              <div className="border-t pt-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">
                  Test API
                </h3>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <StatusIcon ok={status.connected} />
                  <div>
                    <span className="font-medium text-sm">
                      Wywolanie API Stripe (accounts.retrieve)
                    </span>
                    <p className="text-sm text-muted-foreground">
                      {status.connected
                        ? "Polaczenie z API Stripe dziala prawidlowo"
                        : status.configured
                          ? "Polaczenie nie powiodlo sie - sprawdz klucze API"
                          : "Brak klucza API - skonfiguruj STRIPE_SECRET_KEY"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4 text-red-500">
              <XCircle className="h-5 w-5" />
              <span>Nie udalo sie polaczyc z API statusu Stripe</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Jak skonfigurowac Stripe?</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>
              Utworz konto na{" "}
              <a
                href="https://dashboard.stripe.com/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                dashboard.stripe.com
              </a>
            </li>
            <li>
              Przejdz do{" "}
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Developers &gt; API keys
              </a>{" "}
              i skopiuj klucze
            </li>
            <li>Ustaw STRIPE_SECRET_KEY i NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY w pliku .env</li>
            <li>
              Skonfiguruj webhook endpoint na{" "}
              <a
                href="https://dashboard.stripe.com/webhooks"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Developers &gt; Webhooks
              </a>
            </li>
            <li>Utworz produkty i cenniki dla planow Basic i Pro w Stripe Dashboard</li>
            <li>Ustaw STRIPE_PRICE_BASIC i STRIPE_PRICE_PRO w pliku .env</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

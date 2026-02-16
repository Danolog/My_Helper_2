"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Crown,
  Zap,
  CreditCard,
  CalendarDays,
  RefreshCw,
  Loader2,
  Check,
  ArrowUpRight,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type SubscriptionData = {
  id: string;
  salonId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: string;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  createdAt: string;
};

type PlanData = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Aktywna";
    case "past_due":
      return "Zalegla platnosc";
    case "canceled":
      return "Anulowana";
    case "trialing":
      return "Okres probny";
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 hover:bg-green-100 border-green-200";
    case "past_due":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200";
    case "canceled":
      return "bg-red-100 text-red-800 hover:bg-red-100 border-red-200";
    case "trialing":
      return "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200";
    default:
      return "";
  }
}

/**
 * Reads the ?activated query param and shows a toast if present.
 * Must be wrapped in Suspense since it uses useSearchParams.
 */
function ActivationToast() {
  const searchParams = useSearchParams();
  const activated = searchParams.get("activated");

  useEffect(() => {
    if (activated === "true") {
      toast.success("Subskrypcja aktywowana!", {
        description: "Twoj plan zostal pomyslnie aktywowany.",
      });
      // Clean the URL param without navigation
      window.history.replaceState(null, "", "/dashboard/subscription");
    }
  }, [activated]);

  return null;
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscription = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/subscriptions/current");
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Nie udalo sie pobrac subskrypcji");
      }

      setSubscription(data.subscription ?? null);
      setPlan(data.plan ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wystapil blad");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Activation toast handler */}
      <Suspense fallback={null}>
        <ActivationToast />
      </Suspense>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Subskrypcja</h1>
          <p className="text-muted-foreground">
            Zarzadzaj swoim planem i platnosciami
          </p>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72 mt-2" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-40" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <Card>
          <CardContent className="flex flex-col items-center py-8 space-y-4">
            <XCircle className="h-12 w-12 text-destructive" />
            <p className="text-sm text-destructive font-medium">{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setLoading(true);
                fetchSubscription();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Sprobuj ponownie
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No Subscription */}
      {!loading && !error && !subscription && (
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
                <CreditCard className="h-8 w-8 text-muted-foreground" />
              </div>
            </div>
            <CardTitle className="text-xl">Brak aktywnej subskrypcji</CardTitle>
            <CardDescription className="text-base">
              Nie masz jeszcze aktywnego planu. Wybierz plan, ktory najlepiej
              odpowiada Twoim potrzebom.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center space-y-4">
            <Button asChild size="lg">
              <Link href="/pricing">
                Wybierz plan
                <ArrowUpRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active Subscription */}
      {!loading && !error && subscription && plan && (
        <div className="space-y-6">
          {/* Current Plan Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    {plan.slug === "pro" ? (
                      <Crown className="h-5 w-5 text-primary" />
                    ) : (
                      <Zap className="h-5 w-5 text-blue-600" />
                    )}
                  </div>
                  <div>
                    <CardTitle className="text-xl">
                      Plan {plan.name}
                    </CardTitle>
                    <CardDescription>
                      {parseFloat(plan.priceMonthly).toFixed(0)} PLN / miesiac
                    </CardDescription>
                  </div>
                </div>
                <Badge className={statusColor(subscription.status)}>
                  {statusLabel(subscription.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Subscription Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-start gap-3 p-3 rounded-lg border">
                  <CalendarDays className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Poczatek okresu</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(subscription.currentPeriodStart)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border">
                  <CalendarDays className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Nastepna platnosc</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(subscription.currentPeriodEnd)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border">
                  <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Kwota</p>
                    <p className="text-sm text-muted-foreground">
                      {parseFloat(plan.priceMonthly).toFixed(2)} PLN / mies.
                    </p>
                  </div>
                </div>
              </div>

              {/* Plan Features */}
              <div>
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mb-3">
                  Funkcje w Twoim planie
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                {plan.slug === "basic" && (
                  <Button asChild>
                    <Link href="/pricing">
                      <Crown className="h-4 w-4 mr-2" />
                      Zmien na Pro
                    </Link>
                  </Button>
                )}
                <Button variant="outline" disabled>
                  <Loader2 className="h-4 w-4 mr-2 hidden" />
                  Anuluj subskrypcje
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    fetchSubscription();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Odswiez
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Subscription ID info (dev info) */}
          {subscription.stripeSubscriptionId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Informacje techniczne
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    ID subskrypcji
                  </span>
                  <code className="text-xs bg-muted px-2 py-0.5 rounded">
                    {subscription.stripeSubscriptionId}
                  </code>
                </div>
                {subscription.stripeCustomerId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ID klienta</span>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">
                      {subscription.stripeCustomerId}
                    </code>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

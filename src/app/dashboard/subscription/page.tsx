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
  ArrowDownRight,
  AlertTriangle,
  ArrowUp,
  Sparkles,
  Clock,
  Bell,
  ShieldAlert,
  Timer,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PLANS, TRIAL_DAYS } from "@/lib/constants";
import { mutationFetch } from "@/lib/api-client";

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
  scheduledPlanId: string | null;
  scheduledChangeAt: string | null;
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

type ScheduledPlanData = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
} | null;

type AllPlansMap = Record<string, PlanData>;

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
  const upgraded = searchParams.get("upgraded");
  const downgraded = searchParams.get("downgraded");

  useEffect(() => {
    if (upgraded === "true") {
      toast.success("Plan zmieniony na Pro!", {
        description: "Twoj plan zostal pomyslnie zmieniony. Funkcje Pro sa juz dostepne.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    } else if (activated === "true") {
      toast.success("Subskrypcja aktywowana!", {
        description: "Twoj plan zostal pomyslnie aktywowany.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    } else if (downgraded === "true") {
      toast.success("Obnizenie planu zaplanowane!", {
        description: "Plan zostanie zmieniony na Basic po zakonczeniu biezacego okresu rozliczeniowego.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    }
  }, [activated, upgraded, downgraded]);

  return null;
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [allPlans, setAllPlans] = useState<AllPlansMap>({});
  const [scheduledPlan, setScheduledPlan] = useState<ScheduledPlanData>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [changePlanLoading, setChangePlanLoading] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [cancelDowngradeLoading, setCancelDowngradeLoading] = useState(false);
  const [renewLoading, setRenewLoading] = useState(false);
  const [expirationData, setExpirationData] = useState<{
    daysRemaining: number | null;
    warningThreshold: number;
    isNearExpiry: boolean;
    renewalAmount: string | null;
    recentWarnings: Array<{
      id: string;
      type: string;
      message: string;
      status: string;
      sentAt: string | null;
      createdAt: string;
    }>;
  } | null>(null);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [sendWarningLoading, setSendWarningLoading] = useState(false);

  const fetchExpirationWarning = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch("/api/subscriptions/expiration-warning", { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setExpirationData(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      // Non-critical, silently fail
    }
  }, []);

  const fetchSubscription = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      setError(null);
      const [subRes, plansRes] = await Promise.all([
        fetch("/api/subscriptions/current", { signal }),
        fetch("/api/subscription-plans", { signal }),
      ]);
      const subData = await subRes.json();
      const plansData = await plansRes.json();

      if (!subRes.ok || !subData.success) {
        throw new Error(subData.error || "Nie udalo sie pobrac subskrypcji");
      }

      setSubscription(subData.subscription ?? null);
      setPlan(subData.plan ?? null);
      setScheduledPlan(subData.scheduledPlan ?? null);

      // Build a map of all plans by slug for price comparison
      if (plansData.success && Array.isArray(plansData.data)) {
        const map: AllPlansMap = {};
        for (const p of plansData.data) {
          map[p.slug] = p;
        }
        setAllPlans(map);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setError("Nie udalo sie zaladowac informacji o subskrypcji. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSubscription(controller.signal);
    fetchExpirationWarning(controller.signal);
    return () => controller.abort();
  }, [fetchSubscription, fetchExpirationWarning]);

  /**
   * Cancel the current subscription.
   */
  const handleCancel = useCallback(async () => {
    setCancelLoading(true);
    try {
      const res = await mutationFetch("/api/subscriptions/cancel", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie anulowac subskrypcji");
        return;
      }

      toast.success("Subskrypcja anulowana", {
        description: subscription?.currentPeriodEnd
          ? `Dostep do planu jest aktywny do ${formatDate(subscription.currentPeriodEnd)}. Subskrypcja nie zostanie odnowiona.`
          : "Twoja subskrypcja zostala pomyslnie anulowana.",
      });

      // Refresh subscription data
      setLoading(true);
      await fetchSubscription();
    } catch {
      toast.error("Wystapil blad podczas anulowania subskrypcji");
    } finally {
      setCancelLoading(false);
    }
  }, [fetchSubscription]);

  /**
   * Change the plan (upgrade only).
   * Uses the checkout API which handles new subscriptions and upgrades.
   */
  const handleChangePlan = useCallback(
    async (targetSlug: string) => {
      setChangePlanLoading(true);
      try {
        const res = await mutationFetch("/api/subscriptions/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug: targetSlug }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          toast.error(data.error || "Nie udalo sie zmienic planu");
          return;
        }

        // Navigate to checkout URL or refresh if dev fallback
        if (data.url) {
          if (data.url.startsWith("/")) {
            // Dev fallback - local redirect with upgraded param
            window.location.href = data.url;
          } else {
            // Stripe checkout URL
            window.location.href = data.url;
          }
        }
      } catch {
        toast.error("Wystapil blad podczas zmiany planu");
      } finally {
        setChangePlanLoading(false);
      }
    },
    [fetchSubscription],
  );

  /**
   * Schedule a downgrade to a lower plan.
   * The change takes effect at the end of the current billing period.
   */
  const handleDowngrade = useCallback(
    async (targetSlug: string) => {
      setDowngradeLoading(true);
      try {
        const res = await mutationFetch("/api/subscriptions/downgrade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlanSlug: targetSlug }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          toast.error(data.error || "Nie udalo sie zaplanowac obnizenia planu");
          return;
        }

        toast.success("Obnizenie planu zaplanowane", {
          description:
            "Plan zostanie zmieniony na Basic po zakonczeniu biezacego okresu rozliczeniowego.",
        });

        // Refresh subscription data
        setLoading(true);
        await fetchSubscription();
      } catch {
        toast.error("Wystapil blad podczas obnizania planu");
      } finally {
        setDowngradeLoading(false);
      }
    },
    [fetchSubscription],
  );

  /**
   * Cancel a scheduled downgrade.
   */
  const handleCancelDowngrade = useCallback(async () => {
    setCancelDowngradeLoading(true);
    try {
      const res = await mutationFetch("/api/subscriptions/downgrade", {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie anulowac obnizenia planu");
        return;
      }

      toast.success("Obnizenie planu anulowane", {
        description: "Twoj plan Pro pozostaje aktywny.",
      });

      // Refresh subscription data
      setLoading(true);
      await fetchSubscription();
    } catch {
      toast.error("Wystapil blad podczas anulowania obnizenia planu");
    } finally {
      setCancelDowngradeLoading(false);
    }
  }, [fetchSubscription]);

  /**
   * Simulate near-expiry by moving period end to 3 days from now (dev mode).
   */
  const handleSimulateNearExpiry = useCallback(async () => {
    setSimulateLoading(true);
    try {
      const res = await mutationFetch("/api/subscriptions/expiration-warning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulate: true }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie zasymulowac wygasniecia");
        return;
      }

      toast.success("Symulacja wygasniecia aktywowana!", {
        description: `Subskrypcja wygasa za ${data.daysRemaining} dni. Ostrzezenie zostalo wyslane.`,
      });

      // Refresh all data
      setLoading(true);
      await Promise.all([fetchSubscription(), fetchExpirationWarning()]);
    } catch {
      toast.error("Wystapil blad podczas symulacji wygasniecia");
    } finally {
      setSimulateLoading(false);
    }
  }, [fetchSubscription, fetchExpirationWarning]);

  /**
   * Manually send expiration warning notification.
   */
  const handleSendWarning = useCallback(async () => {
    setSendWarningLoading(true);
    try {
      const res = await mutationFetch("/api/subscriptions/expiration-warning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warningDays: 30 }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie wyslac ostrzezenia");
        return;
      }

      if (data.warnings && data.warnings.length > 0) {
        toast.success("Ostrzezenie wyslane!", {
          description: `Wyslano ${data.warnings.length} powiadomien. Subskrypcja wygasa za ${data.daysRemaining} dni.`,
        });
      } else {
        toast.info("Brak potrzeby ostrzezenia", {
          description: data.message,
        });
      }

      await fetchExpirationWarning();
    } catch {
      toast.error("Wystapil blad podczas wysylania ostrzezenia");
    } finally {
      setSendWarningLoading(false);
    }
  }, [fetchExpirationWarning]);

  /**
   * Simulate automatic subscription renewal (dev mode).
   * In production, this is handled by Stripe webhooks (invoice.paid).
   */
  const handleSimulateRenewal = useCallback(async () => {
    setRenewLoading(true);
    try {
      const res = await mutationFetch("/api/subscriptions/renew", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie odnowic subskrypcji");
        return;
      }

      toast.success("Subskrypcja odnowiona!", {
        description: data.planChanged
          ? `Plan zmieniony z ${data.previousPlan} na ${data.newPlan}. Nowy okres do ${formatDate(data.subscription?.currentPeriodEnd)}.`
          : `Nowy okres rozliczeniowy do ${formatDate(data.subscription?.currentPeriodEnd)}. Oplata: ${data.subscription?.amount} PLN.`,
      });

      // Refresh subscription data
      setLoading(true);
      await fetchSubscription();
    } catch {
      toast.error("Wystapil blad podczas odnawiania subskrypcji");
    } finally {
      setRenewLoading(false);
    }
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
                    <p className="text-sm font-medium">
                      {subscription.status === "trialing" ? "Koniec okresu probnego" : "Nastepna platnosc"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {subscription.status === "trialing" && subscription.trialEndsAt
                        ? formatDate(subscription.trialEndsAt)
                        : formatDate(subscription.currentPeriodEnd)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border">
                  <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">
                      {subscription.status === "trialing" ? "Cena po okresie probnym" : "Kwota"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {parseFloat(plan.priceMonthly).toFixed(2)} PLN / mies.
                    </p>
                  </div>
                </div>
              </div>

              {/* Trial period notice */}
              {subscription.status === "trialing" && subscription.trialEndsAt && (() => {
                const trialEnd = new Date(subscription.trialEndsAt!);
                const now = new Date();
                const daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
                const trialStart = new Date(subscription.createdAt);
                const totalTrialDays = Math.ceil((trialEnd.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
                const progressPercent = Math.min(100, Math.max(0, ((totalTrialDays - daysRemaining) / totalTrialDays) * 100));
                const isNearEnd = daysRemaining <= 3;

                return (
                  <div className={`flex flex-col gap-4 p-4 rounded-lg border ${
                    isNearEnd
                      ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                      : "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
                  }`}>
                    <div className="flex items-start gap-3">
                      {isNearEnd ? (
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <Timer className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${
                          isNearEnd
                            ? "text-amber-800 dark:text-amber-200"
                            : "text-blue-800 dark:text-blue-200"
                        }`}>
                          {isNearEnd
                            ? `Okres probny konczy sie za ${daysRemaining} ${daysRemaining === 1 ? "dzien" : "dni"}!`
                            : `Okres probny - pozostalo ${daysRemaining} ${daysRemaining === 1 ? "dzien" : "dni"}`
                          }
                        </p>
                        <p className={`text-sm mt-1 ${
                          isNearEnd
                            ? "text-amber-600 dark:text-amber-300"
                            : "text-blue-600 dark:text-blue-300"
                        }`}>
                          {isNearEnd
                            ? "Wykup subskrypcje, aby zachowac dostep do wszystkich funkcji po zakonczeniu okresu probnego."
                            : `Korzystasz z pelnych funkcji planu ${plan.name} w ramach ${TRIAL_DAYS}-dniowego okresu probnego. Okres probny konczy sie ${formatDate(subscription.trialEndsAt)}.`
                          }
                        </p>
                      </div>
                    </div>

                    {/* Trial progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={isNearEnd ? "text-amber-700 dark:text-amber-300" : "text-blue-700 dark:text-blue-300"}>
                          Poczatek: {formatDate(subscription.createdAt)}
                        </span>
                        <span className={`font-medium ${isNearEnd ? "text-amber-700 dark:text-amber-300" : "text-blue-700 dark:text-blue-300"}`}>
                          Koniec: {formatDate(subscription.trialEndsAt)}
                        </span>
                      </div>
                      <div className="w-full bg-white dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all ${
                            isNearEnd ? "bg-amber-500" : "bg-blue-500"
                          }`}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="text-xs text-center">
                        <span className={isNearEnd ? "text-amber-700 dark:text-amber-300" : "text-blue-700 dark:text-blue-300"}>
                          {totalTrialDays - daysRemaining} z {totalTrialDays} dni wykorzystanych
                        </span>
                      </div>
                    </div>

                    {/* Subscribe CTA button */}
                    <div className="flex items-center gap-3 mt-1">
                      <Button
                        size="sm"
                        onClick={() => handleChangePlan(plan.slug)}
                        disabled={changePlanLoading}
                        className={isNearEnd ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
                      >
                        {changePlanLoading ? (
                          <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                        ) : (
                          <CreditCard className="h-3 w-3 mr-2" />
                        )}
                        Wykup subskrypcje
                      </Button>
                      <span className={`text-xs ${isNearEnd ? "text-amber-600 dark:text-amber-300" : "text-blue-600 dark:text-blue-300"}`}>
                        {parseFloat(plan.priceMonthly).toFixed(0)} PLN / miesiac po okresie probnym
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Canceled notice */}
              {subscription.status === "canceled" && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800">
                  <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      Subskrypcja anulowana
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-300">
                      {subscription.canceledAt
                        ? `Anulowano: ${formatDate(subscription.canceledAt)}. `
                        : "Twoja subskrypcja zostala anulowana. "}
                      {subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > new Date()
                        ? `Dostep do funkcji planu jest aktywny do ${formatDate(subscription.currentPeriodEnd)}.`
                        : "Dostep do funkcji planu zakonczyl sie."
                      }
                      {" "}Mozesz w kazdej chwili ponownie aktywowac plan.
                    </p>
                  </div>
                </div>
              )}

              {/* Pending downgrade notice */}
              {subscription.scheduledPlanId && scheduledPlan && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Zaplanowane obnizenie planu
                    </p>
                    <p className="text-sm text-amber-600 dark:text-amber-300">
                      Twoj plan zostanie zmieniony na{" "}
                      <span className="font-semibold">{scheduledPlan.name}</span>{" "}
                      ({parseFloat(scheduledPlan.priceMonthly).toFixed(0)} PLN / mies.)
                      {subscription.scheduledChangeAt
                        ? ` dnia ${formatDate(subscription.scheduledChangeAt)}`
                        : " po zakonczeniu biezacego okresu rozliczeniowego"}
                      . Do tego czasu zachowujesz pelny dostep do funkcji Pro.
                    </p>
                    <div className="mt-3">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={cancelDowngradeLoading}
                            className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
                          >
                            {cancelDowngradeLoading ? (
                              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            ) : (
                              <XCircle className="h-3 w-3 mr-2" />
                            )}
                            Anuluj obnizenie planu
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Anulowac obnizenie planu?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Twoj plan Pro pozostanie aktywny bez zmian. Zaplanowane
                              obnizenie do planu {scheduledPlan.name} zostanie anulowane.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Nie, zachowaj obnizenie</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCancelDowngrade}>
                              Tak, anuluj obnizenie
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              )}

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
                {/* Upgrade: Basic → Pro */}
                {(subscription.status === "active" || subscription.status === "trialing") && plan.slug === "basic" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={changePlanLoading}>
                        {changePlanLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Crown className="h-4 w-4 mr-2" />
                        )}
                        Zmien na Pro
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-w-lg">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <ArrowUp className="h-5 w-5 text-primary" />
                          Upgrade do planu Pro
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-4">
                            <p>
                              Przejdz na plan Pro i odblokuj wszystkie funkcje AI,
                              w tym asystenta glosowego, biznesowego i content
                              marketingowego.
                            </p>

                            {/* Price comparison */}
                            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Zap className="h-4 w-4 text-blue-600" />
                                  <span className="font-medium">Obecny plan: Basic</span>
                                </span>
                                <span className="font-semibold">
                                  {parseFloat(plan.priceMonthly).toFixed(0)} PLN / mies.
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Crown className="h-4 w-4 text-primary" />
                                  <span className="font-medium">Nowy plan: Pro</span>
                                </span>
                                <span className="font-semibold">
                                  {allPlans["pro"]
                                    ? `${parseFloat(allPlans["pro"].priceMonthly).toFixed(0)} PLN / mies.`
                                    : `${PLANS.pro.priceMonthly} PLN / mies.`}
                                </span>
                              </div>
                              <div className="border-t pt-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-primary">Roznica w cenie</span>
                                <span className="font-bold text-primary">
                                  {allPlans["pro"]
                                    ? `+${(parseFloat(allPlans["pro"].priceMonthly) - parseFloat(plan.priceMonthly)).toFixed(0)} PLN / mies.`
                                    : `+${PLANS.pro.priceMonthly - PLANS.basic.priceMonthly} PLN / mies.`}
                                </span>
                              </div>
                            </div>

                            {/* Extra features gained */}
                            {allPlans["pro"] && (
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Dodatkowe funkcje w planie Pro
                                </p>
                                <div className="grid gap-1.5">
                                  {allPlans["pro"].features
                                    .filter((f) => !plan.features.includes(f) && f !== "Wszystko z planu Basic")
                                    .map((feature, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-sm">
                                        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                        <span>{feature}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Anuluj</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleChangePlan("pro")}
                          disabled={changePlanLoading}
                        >
                          {changePlanLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Crown className="h-4 w-4 mr-2" />
                          )}
                          Potwierdz upgrade do Pro
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Downgrade: Pro → Basic (only if no pending downgrade) */}
                {(subscription.status === "active" || subscription.status === "trialing") && plan.slug === "pro" && !subscription.scheduledPlanId && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={downgradeLoading}
                      >
                        {downgradeLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4 mr-2" />
                        )}
                        Zmien na Basic
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-w-lg">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <ArrowDownRight className="h-5 w-5 text-amber-600" />
                          Obnizenie do planu Basic
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-4">
                            <p>
                              Czy na pewno chcesz obnizyc plan do Basic? Po zakonczeniu
                              biezacego okresu rozliczeniowego stracisz dostep do:
                            </p>

                            {/* AI features that will be lost */}
                            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                Funkcje AI, ktore stracisz
                              </p>
                              <div className="grid gap-1.5">
                                <div className="flex items-start gap-2 text-sm">
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                  <span>Asystent glosowy AI</span>
                                </div>
                                <div className="flex items-start gap-2 text-sm">
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                  <span>Asystent biznesowy AI</span>
                                </div>
                                <div className="flex items-start gap-2 text-sm">
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                  <span>Content marketing AI</span>
                                </div>
                                <div className="flex items-start gap-2 text-sm">
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                  <span>Automatyczne odpowiedzi na opinie</span>
                                </div>
                                <div className="flex items-start gap-2 text-sm">
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                  <span>Analiza sentymentu opinii</span>
                                </div>
                              </div>
                            </div>

                            {/* Price comparison */}
                            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Crown className="h-4 w-4 text-primary" />
                                  <span className="font-medium">Obecny plan: Pro</span>
                                </span>
                                <span className="font-semibold">
                                  {parseFloat(plan.priceMonthly).toFixed(0)} PLN / mies.
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Zap className="h-4 w-4 text-blue-600" />
                                  <span className="font-medium">Nowy plan: Basic</span>
                                </span>
                                <span className="font-semibold">
                                  {allPlans["basic"]
                                    ? `${parseFloat(allPlans["basic"].priceMonthly).toFixed(0)} PLN / mies.`
                                    : `${PLANS.basic.priceMonthly} PLN / mies.`}
                                </span>
                              </div>
                              <div className="border-t pt-2 flex items-center justify-between text-sm">
                                <span className="font-medium text-green-600">Oszczedzasz</span>
                                <span className="font-bold text-green-600">
                                  {allPlans["basic"]
                                    ? `${(parseFloat(plan.priceMonthly) - parseFloat(allPlans["basic"].priceMonthly)).toFixed(0)} PLN / mies.`
                                    : "100 PLN / mies."}
                                </span>
                              </div>
                            </div>

                            {/* When it takes effect */}
                            <div className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CalendarDays className="h-4 w-4 shrink-0 mt-0.5" />
                              <span>
                                Zmiana wejdzie w zycie po zakonczeniu biezacego okresu
                                rozliczeniowego{subscription.currentPeriodEnd
                                  ? ` (${formatDate(subscription.currentPeriodEnd)})`
                                  : ""}.
                                Do tego czasu zachowasz pelny dostep do funkcji Pro.
                              </span>
                            </div>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Anuluj</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDowngrade("basic")}
                          disabled={downgradeLoading}
                          className="bg-amber-600 text-white hover:bg-amber-700"
                        >
                          {downgradeLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4 mr-2" />
                          )}
                          Potwierdz obnizenie planu
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Cancel subscription */}
                {(subscription.status === "active" || subscription.status === "trialing") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        disabled={cancelLoading}
                      >
                        {cancelLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4 mr-2" />
                        )}
                        Anuluj subskrypcje
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Anulowac subskrypcje?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-3">
                            <p>
                              Czy na pewno chcesz anulowac subskrypcje planu{" "}
                              <span className="font-semibold">{plan.name}</span>?
                            </p>
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
                              <CalendarDays className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                              <p className="text-sm text-blue-700 dark:text-blue-300">
                                Zachowasz dostep do wszystkich funkcji planu {plan.name} do
                                konca biezacego okresu rozliczeniowego
                                {subscription.currentPeriodEnd
                                  ? ` (${formatDate(subscription.currentPeriodEnd)})`
                                  : ""}
                                . Po tym terminie subskrypcja nie zostanie odnowiona.
                              </p>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Mozesz ponownie aktywowac subskrypcje w dowolnym momencie.
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Nie, zachowaj</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleCancel}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Tak, anuluj subskrypcje
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Reactivate subscription if canceled */}
                {subscription.status === "canceled" && (
                  <Button asChild>
                    <Link href="/pricing">
                      <ArrowUpRight className="h-4 w-4 mr-2" />
                      Aktywuj ponownie
                    </Link>
                  </Button>
                )}

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

          {/* Payment History Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/30">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">Historia platnosci</CardTitle>
                  <CardDescription>
                    Przegladaj platnosci za subskrypcje i pobieraj potwierdzenia
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/subscription/payments">
                    Zobacz historie
                    <ArrowUpRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Expiration Warning Card */}
          {(subscription.status === "active" || subscription.status === "trialing") && expirationData && (
            <Card className={expirationData.isNearExpiry ? "border-amber-300 dark:border-amber-700" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                      expirationData.isNearExpiry
                        ? "bg-amber-100 dark:bg-amber-950/30"
                        : "bg-blue-100 dark:bg-blue-950/30"
                    }`}>
                      {expirationData.isNearExpiry ? (
                        <ShieldAlert className="h-5 w-5 text-amber-600" />
                      ) : (
                        <Timer className="h-5 w-5 text-blue-600" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-lg">
                        {expirationData.isNearExpiry
                          ? "Ostrzezenie o wygasnieciu"
                          : "Status subskrypcji"}
                      </CardTitle>
                      <CardDescription>
                        {expirationData.isNearExpiry
                          ? "Twoja subskrypcja wkrotce wygasa"
                          : "Informacje o terminie odnowienia"}
                      </CardDescription>
                    </div>
                  </div>
                  {expirationData.isNearExpiry && (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
                      <Clock className="h-3 w-3 mr-1" />
                      Wygasa wkrotce
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Days remaining display */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Dni do odnowienia</span>
                    <span className={`font-bold text-lg ${
                      expirationData.daysRemaining !== null && expirationData.daysRemaining <= 3
                        ? "text-red-600"
                        : expirationData.isNearExpiry
                          ? "text-amber-600"
                          : "text-green-600"
                    }`}>
                      {expirationData.daysRemaining !== null
                        ? `${expirationData.daysRemaining} ${expirationData.daysRemaining === 1 ? "dzien" : "dni"}`
                        : "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Data odnowienia</span>
                    <span className="font-medium">
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Kwota odnowienia</span>
                    <span className="font-medium">
                      {expirationData.renewalAmount
                        ? `${parseFloat(expirationData.renewalAmount).toFixed(2)} PLN`
                        : "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Prog ostrzezenia</span>
                    <span className="font-medium">
                      {expirationData.warningThreshold} dni przed wygasnieciem
                    </span>
                  </div>
                </div>

                {/* Near expiry warning banner */}
                {expirationData.isNearExpiry && (
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Subskrypcja wygasa za {expirationData.daysRemaining}{" "}
                        {expirationData.daysRemaining === 1 ? "dzien" : "dni"}!
                      </p>
                      <p className="text-sm text-amber-600 dark:text-amber-300 mt-1">
                        Upewnij sie, ze Twoja metoda platnosci jest aktualna, aby uniknac
                        przerwy w dostepie do uslug. Kwota odnowienia:{" "}
                        <span className="font-semibold">
                          {expirationData.renewalAmount
                            ? `${parseFloat(expirationData.renewalAmount).toFixed(2)} PLN`
                            : "-"}
                        </span>.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100">
                          <CreditCard className="h-3 w-3 mr-2" />
                          Sprawdz metode platnosci
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSimulateRenewal}
                          disabled={renewLoading}
                        >
                          {renewLoading ? (
                            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-2" />
                          )}
                          Odnow teraz
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent warnings */}
                {expirationData.recentWarnings.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      Ostatnie ostrzezenia
                    </h4>
                    <div className="space-y-2">
                      {expirationData.recentWarnings.map((warning) => (
                        <div
                          key={warning.id}
                          className="flex items-start gap-3 p-3 rounded-lg border text-sm"
                        >
                          <div className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                            warning.type === "email"
                              ? "bg-blue-100 text-blue-700"
                              : warning.type === "push"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-100 text-gray-700"
                          }`}>
                            {warning.type === "email" ? "Email" : warning.type === "push" ? "Push" : warning.type.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {warning.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {warning.sentAt ? formatDate(warning.sentAt) : formatDate(warning.createdAt)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              warning.status === "sent"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : warning.status === "pending"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-red-50 text-red-700 border-red-200"
                            }
                          >
                            {warning.status === "sent"
                              ? "Wyslano"
                              : warning.status === "pending"
                                ? "Oczekuje"
                                : "Blad"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dev mode: Simulation controls */}
                <div className="pt-2 border-t">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Tryb deweloperski
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSimulateNearExpiry}
                      disabled={simulateLoading}
                    >
                      {simulateLoading ? (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      ) : (
                        <ShieldAlert className="h-3 w-3 mr-2" />
                      )}
                      Symuluj wygasniecie (3 dni)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSendWarning}
                      disabled={sendWarningLoading}
                    >
                      {sendWarningLoading ? (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      ) : (
                        <Bell className="h-3 w-3 mr-2" />
                      )}
                      Wyslij ostrzezenie
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Automatic Renewal Card */}
          {subscription.status === "active" && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-950/30">
                    <RefreshCw className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">
                      Automatyczne odnowienie
                    </CardTitle>
                    <CardDescription>
                      Subskrypcja odnawia sie automatycznie co miesiac
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status odnowienia</span>
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                      Aktywne
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Nastepne odnowienie</span>
                    <span className="font-medium">
                      {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Kwota odnowienia</span>
                    <span className="font-medium">
                      {scheduledPlan
                        ? `${parseFloat(scheduledPlan.priceMonthly).toFixed(2)} PLN (plan ${scheduledPlan.name})`
                        : `${parseFloat(plan.priceMonthly).toFixed(2)} PLN`}
                    </span>
                  </div>
                  {scheduledPlan && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Zmiana planu</span>
                      <span className="font-medium text-amber-600">
                        {plan.name} → {scheduledPlan.name}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Twoja subskrypcja zostanie automatycznie odnowiona{" "}
                    {formatDate(subscription.currentPeriodEnd)}. Oplata{" "}
                    {scheduledPlan
                      ? `${parseFloat(scheduledPlan.priceMonthly).toFixed(2)} PLN`
                      : `${parseFloat(plan.priceMonthly).toFixed(2)} PLN`}{" "}
                    zostanie pobrana automatycznie z Twojej metody platnosci.
                  </span>
                </div>

                {/* Dev mode: Simulate renewal button */}
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Tryb deweloperski
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Symuluj automatyczne odnowienie subskrypcji
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSimulateRenewal}
                      disabled={renewLoading}
                    >
                      {renewLoading ? (
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-2" />
                      )}
                      Symuluj odnowienie
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

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

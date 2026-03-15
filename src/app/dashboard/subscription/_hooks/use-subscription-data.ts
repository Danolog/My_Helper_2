"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type {
  SubscriptionData,
  PlanData,
  ScheduledPlanData,
  AllPlansMap,
  ExpirationData,
} from "../_types";
import { formatDate } from "../_types";

interface UseSubscriptionDataReturn {
  subscription: SubscriptionData | null;
  plan: PlanData | null;
  allPlans: AllPlansMap;
  scheduledPlan: ScheduledPlanData;
  loading: boolean;
  error: string | null;
  expirationData: ExpirationData | null;
  cancelLoading: boolean;
  changePlanLoading: boolean;
  downgradeLoading: boolean;
  cancelDowngradeLoading: boolean;
  renewLoading: boolean;
  simulateLoading: boolean;
  sendWarningLoading: boolean;
  fetchSubscription: (signal?: AbortSignal | null) => Promise<void>;
  handleCancel: () => Promise<void>;
  handleChangePlan: (targetSlug: string) => Promise<void>;
  handleDowngrade: (targetSlug: string) => Promise<void>;
  handleCancelDowngrade: () => Promise<void>;
  handleSimulateNearExpiry: () => Promise<void>;
  handleSendWarning: () => Promise<void>;
  handleSimulateRenewal: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export function useSubscriptionData(): UseSubscriptionDataReturn {
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
  const [expirationData, setExpirationData] = useState<ExpirationData | null>(
    null,
  );
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [sendWarningLoading, setSendWarningLoading] = useState(false);

  const fetchExpirationWarning = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        const res = await fetch("/api/subscriptions/expiration-warning", {
          signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data) {
          setExpirationData(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        // Non-critical, silently fail
      }
    },
    [],
  );

  const fetchSubscription = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        setError(null);
        const [subRes, plansRes] = await Promise.all([
          fetch("/api/subscriptions/current", { signal }),
          fetch("/api/subscription-plans", { signal }),
        ]);
        const subData = await subRes.json();
        const plansData = await plansRes.json();

        if (!subRes.ok || !subData.success) {
          throw new Error(
            subData.error || "Nie udalo sie pobrac subskrypcji",
          );
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
        setError(
          "Nie udalo sie zaladowac informacji o subskrypcji. Sprobuj ponownie pozniej.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchSubscription(controller.signal);
    fetchExpirationWarning(controller.signal);
    return () => controller.abort();
  }, [fetchSubscription, fetchExpirationWarning]);

  /** Cancel the current subscription. */
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
  }, [fetchSubscription, subscription?.currentPeriodEnd]);

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
          toast.error(
            data.error || "Nie udalo sie zaplanowac obnizenia planu",
          );
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

  /** Cancel a scheduled downgrade. */
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

  /** Simulate near-expiry by moving period end to 3 days from now (dev mode). */
  const handleSimulateNearExpiry = useCallback(async () => {
    setSimulateLoading(true);
    try {
      const res = await mutationFetch(
        "/api/subscriptions/expiration-warning",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulate: true }),
        },
      );
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

  /** Manually send expiration warning notification. */
  const handleSendWarning = useCallback(async () => {
    setSendWarningLoading(true);
    try {
      const res = await mutationFetch(
        "/api/subscriptions/expiration-warning",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warningDays: 30 }),
        },
      );
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

  return {
    subscription,
    plan,
    allPlans,
    scheduledPlan,
    loading,
    error,
    expirationData,
    cancelLoading,
    changePlanLoading,
    downgradeLoading,
    cancelDowngradeLoading,
    renewLoading,
    simulateLoading,
    sendWarningLoading,
    fetchSubscription,
    handleCancel,
    handleChangePlan,
    handleDowngrade,
    handleCancelDowngrade,
    handleSimulateNearExpiry,
    handleSendWarning,
    handleSimulateRenewal,
    setLoading,
  };
}

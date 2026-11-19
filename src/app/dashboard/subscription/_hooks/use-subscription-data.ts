"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { cancelSuccessDescription } from "../_types";
import type {
  AccessData,
  SubscriptionData,
  PlanData,
  ScheduledPlanData,
  AllPlansMap,
  ExpirationData,
} from "../_types";

interface UseSubscriptionDataReturn {
  subscription: SubscriptionData | null;
  plan: PlanData | null;
  allPlans: AllPlansMap;
  scheduledPlan: ScheduledPlanData;
  access: AccessData | null;
  purchaseBlockedUntil: string | null;
  loading: boolean;
  error: string | null;
  expirationData: ExpirationData | null;
  cancelLoading: boolean;
  changePlanLoading: boolean;
  downgradeLoading: boolean;
  cancelDowngradeLoading: boolean;
  fetchSubscription: (signal?: AbortSignal | null) => Promise<void>;
  handleCancel: () => Promise<void>;
  handleChangePlan: (targetSlug: string) => Promise<void>;
  handleDowngrade: (targetSlug: string) => Promise<void>;
  handleCancelDowngrade: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export function useSubscriptionData(): UseSubscriptionDataReturn {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [allPlans, setAllPlans] = useState<AllPlansMap>({});
  const [scheduledPlan, setScheduledPlan] = useState<ScheduledPlanData>(null);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [purchaseBlockedUntil, setPurchaseBlockedUntil] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [changePlanLoading, setChangePlanLoading] = useState(false);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [cancelDowngradeLoading, setCancelDowngradeLoading] = useState(false);
  const [expirationData, setExpirationData] = useState<ExpirationData | null>(
    null,
  );

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
        setAccess(subData.access ?? null);
        setPurchaseBlockedUntil(subData.purchaseBlockedUntil ?? null);

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
        description: cancelSuccessDescription(
          data.subscription?.currentPeriodEnd ??
            subscription?.currentPeriodEnd,
          new Date(),
        ),
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
          // 409: the purchase was refused; refresh the current subscription data.
          if (res.status === 409) {
            await fetchSubscription();
          }
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

  return {
    subscription,
    plan,
    allPlans,
    scheduledPlan,
    access,
    purchaseBlockedUntil,
    loading,
    error,
    expirationData,
    cancelLoading,
    changePlanLoading,
    downgradeLoading,
    cancelDowngradeLoading,
    fetchSubscription,
    handleCancel,
    handleChangePlan,
    handleDowngrade,
    handleCancelDowngrade,
    setLoading,
  };
}

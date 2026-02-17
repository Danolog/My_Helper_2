"use client";

import { useEffect, useState } from "react";

type PlanData = {
  slug: string;
  name: string;
  priceMonthly: string;
  features: string[];
};

type SubscriptionState = {
  plan: PlanData | null;
  loading: boolean;
  error: string | null;
  isProPlan: boolean;
  isBasicPlan: boolean;
};

/**
 * Hook to get the current subscription plan for the salon.
 * Uses the existing /api/subscriptions/current endpoint.
 */
export function useSubscription(): SubscriptionState {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch("/api/subscriptions/current", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.plan) {
          setPlan({
            slug: data.plan.slug,
            name: data.plan.name,
            priceMonthly: data.plan.priceMonthly,
            features: data.plan.features || [],
          });
        } else {
          // No subscription found, default to basic
          setPlan({ slug: "basic", name: "Basic", priceMonthly: "49.00", features: [] });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nie udalo sie pobrac planu");
        setPlan({ slug: "basic", name: "Basic", priceMonthly: "49.00", features: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchPlan();
  }, []);

  return {
    plan,
    loading,
    error,
    isProPlan: plan?.slug === "pro",
    isBasicPlan: plan?.slug !== "pro",
  };
}

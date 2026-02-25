"use client";

import { useEffect, useState } from "react";
import { PLANS } from "@/lib/constants";

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
  isTrialing: boolean;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
};

/**
 * Hook to get the current subscription plan for the salon.
 * Uses the existing /api/subscriptions/current endpoint.
 */
export function useSubscription(): SubscriptionState {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTrialing, setIsTrialing] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

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
          setPlan({ slug: PLANS.basic.slug, name: PLANS.basic.name, priceMonthly: String(PLANS.basic.priceMonthly) + ".00", features: [] });
        }
        // Extract trial info from subscription
        if (data.subscription) {
          setIsTrialing(data.subscription.status === "trialing");
          setTrialEndsAt(data.subscription.trialEndsAt || null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nie udalo sie pobrac planu");
        setPlan({ slug: PLANS.basic.slug, name: PLANS.basic.name, priceMonthly: String(PLANS.basic.priceMonthly) + ".00", features: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchPlan();
  }, []);

  // Calculate days remaining in trial
  let trialDaysRemaining: number | null = null;
  if (isTrialing && trialEndsAt) {
    const trialEnd = new Date(trialEndsAt);
    const now = new Date();
    trialDaysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  return {
    plan,
    loading,
    error,
    isProPlan: plan?.slug === "pro",
    isBasicPlan: plan?.slug !== "pro",
    isTrialing,
    trialEndsAt,
    trialDaysRemaining,
  };
}

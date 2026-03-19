"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Lock } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { DashboardEmployeesToday } from "@/components/dashboard/dashboard-employees-today";
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import { DashboardStatsRow } from "@/components/dashboard/dashboard-stats-row";
import { DashboardTodayAppointments } from "@/components/dashboard/dashboard-today-appointments";
import { DashboardTrialBanner } from "@/components/dashboard/dashboard-trial-banner";
import type { DashboardStats, UserSalon } from "@/components/dashboard/dashboard-types";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";

// Lazy-load AI recommendation components (only rendered for Pro plan users)
const DailyRecommendations = dynamic(
  () => import("@/components/dashboard/daily-recommendations").then((m) => ({ default: m.DailyRecommendations })),
  {
    loading: () => <Skeleton className="h-48 rounded-lg mb-6" />,
  },
);

const WeeklyRecommendations = dynamic(
  () => import("@/components/dashboard/weekly-recommendations").then((m) => ({ default: m.WeeklyRecommendations })),
  {
    loading: () => <Skeleton className="h-48 rounded-lg mb-6" />,
  },
);

// Lazy-load salon creation prompt (only shown when user has no salon)
const CreateSalonPrompt = dynamic(
  () => import("@/components/dashboard/create-salon-prompt").then((m) => ({ default: m.CreateSalonPrompt })),
  {
    loading: () => (
      <div className="flex justify-center items-center h-64">
        <Skeleton className="h-64 w-full max-w-lg rounded-lg" />
      </div>
    ),
  },
);


export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const { isProPlan } = useSubscription();
  const [, setSalon] = useState<UserSalon | null>(null);
  const [noSalon, setNoSalon] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Fetch the user's salon, then dashboard stats
  useEffect(() => {
    const abortController = new AbortController();

    async function fetchSalonAndStats() {
      try {
        setStatsLoading(true);
        setStatsError(null);

        // Step 1: Fetch the user's salon
        const salonRes = await fetch("/api/salons/mine", { signal: abortController.signal });
        if (!salonRes.ok) {
          const err = await salonRes.json().catch(() => ({ error: "Blad serwera" }));
          throw new Error(err.error || "Nie udalo sie pobrac salonu");
        }
        const salonJson = await salonRes.json();

        if (!salonJson.salon) {
          // User has no salon yet
          setNoSalon(true);
          setStatsLoading(false);
          return;
        }

        setSalon({ id: salonJson.salon.id, name: salonJson.salon.name });

        // Step 2: Fetch dashboard stats using the salon ID
        const res = await fetch(
          `/api/dashboard/stats?salonId=${salonJson.salon.id}`,
          { signal: abortController.signal }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Blad serwera" }));
          throw new Error(err.error || "Nie udalo sie pobrac statystyk");
        }
        const json = await res.json();
        if (json.success) {
          setStats(json.data);
        }
      } catch (e) {
        // Silently ignore aborted requests (component unmounted or deps changed)
        if (e instanceof Error && e.name === "AbortError") return;
        setStatsError(
          e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"
        );
      } finally {
        setStatsLoading(false);
      }
    }

    if (session) {
      fetchSalonAndStats();
    }

    return () => abortController.abort();
  }, [session]);

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-2xl font-bold mb-2">Protected Page</h1>
            <p className="text-muted-foreground mb-6">
              You need to sign in to access the dashboard
            </p>
          </div>
          <UserProfile />
        </div>
      </div>
    );
  }

  // User has no salon yet -- show inline salon creation
  if (noSalon && !statsLoading) {
    return <CreateSalonPrompt session={session} onCreated={() => { setNoSalon(false); window.location.reload(); }} />;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      <DashboardTrialBanner />

      {/* Daily AI Recommendations - shown for Pro plan users (Feature #32) */}
      {isProPlan && <DailyRecommendations />}

      {/* Weekly AI Recommendations - shown for Pro plan users (Feature #32) */}
      {isProPlan && <WeeklyRecommendations />}

      <DashboardQuickActions />

      <DashboardStatsRow stats={stats} statsLoading={statsLoading} statsError={statsError} />

      <DashboardTodayAppointments stats={stats} statsLoading={statsLoading} statsError={statsError} />

      <DashboardEmployeesToday stats={stats} statsLoading={statsLoading} statsError={statsError} />
    </div>
  );
}

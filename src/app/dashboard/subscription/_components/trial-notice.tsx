"use client";

import { AlertTriangle, Timer, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/lib/constants";
import type { SubscriptionData, PlanData } from "../_types";
import { formatDate } from "../_types";

interface TrialNoticeProps {
  subscription: SubscriptionData;
  plan: PlanData;
  changePlanLoading: boolean;
  onChangePlan: (slug: string) => Promise<void>;
}

export function TrialNotice({
  subscription,
  plan,
  changePlanLoading,
  onChangePlan,
}: TrialNoticeProps) {
  if (subscription.status !== "trialing" || !subscription.trialEndsAt) {
    return null;
  }

  const trialEnd = new Date(subscription.trialEndsAt);
  const now = new Date();
  const daysRemaining = Math.max(
    0,
    Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const trialStart = new Date(subscription.createdAt);
  const totalTrialDays = Math.ceil(
    (trialEnd.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  const progressPercent = Math.min(
    100,
    Math.max(0, ((totalTrialDays - daysRemaining) / totalTrialDays) * 100),
  );
  const isNearEnd = daysRemaining <= 3;

  return (
    <div
      className={`flex flex-col gap-4 p-4 rounded-lg border ${
        isNearEnd
          ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
          : "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
      }`}
    >
      <div className="flex items-start gap-3">
        {isNearEnd ? (
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        ) : (
          <Timer className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <p
            className={`text-sm font-medium ${
              isNearEnd
                ? "text-amber-800 dark:text-amber-200"
                : "text-blue-800 dark:text-blue-200"
            }`}
          >
            {isNearEnd
              ? `Okres probny konczy sie za ${daysRemaining} ${daysRemaining === 1 ? "dzien" : "dni"}!`
              : `Okres probny - pozostalo ${daysRemaining} ${daysRemaining === 1 ? "dzien" : "dni"}`}
          </p>
          <p
            className={`text-sm mt-1 ${
              isNearEnd
                ? "text-amber-600 dark:text-amber-300"
                : "text-blue-600 dark:text-blue-300"
            }`}
          >
            {isNearEnd
              ? "Wykup subskrypcje, aby zachowac dostep do wszystkich funkcji po zakonczeniu okresu probnego."
              : `Korzystasz z pelnych funkcji planu ${plan.name} w ramach ${TRIAL_DAYS}-dniowego okresu probnego. Okres probny konczy sie ${formatDate(subscription.trialEndsAt)}.`}
          </p>
        </div>
      </div>

      {/* Trial progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span
            className={
              isNearEnd
                ? "text-amber-700 dark:text-amber-300"
                : "text-blue-700 dark:text-blue-300"
            }
          >
            Poczatek: {formatDate(subscription.createdAt)}
          </span>
          <span
            className={`font-medium ${isNearEnd ? "text-amber-700 dark:text-amber-300" : "text-blue-700 dark:text-blue-300"}`}
          >
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
          <span
            className={
              isNearEnd
                ? "text-amber-700 dark:text-amber-300"
                : "text-blue-700 dark:text-blue-300"
            }
          >
            {totalTrialDays - daysRemaining} z {totalTrialDays} dni
            wykorzystanych
          </span>
        </div>
      </div>

      {/* Subscribe CTA button */}
      <div className="flex items-center gap-3 mt-1">
        <Button
          size="sm"
          onClick={() => onChangePlan(plan.slug)}
          disabled={changePlanLoading}
          className={
            isNearEnd ? "bg-amber-600 hover:bg-amber-700 text-white" : ""
          }
        >
          {changePlanLoading ? (
            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
          ) : (
            <CreditCard className="h-3 w-3 mr-2" />
          )}
          Wykup subskrypcje
        </Button>
        <span
          className={`text-xs ${isNearEnd ? "text-amber-600 dark:text-amber-300" : "text-blue-600 dark:text-blue-300"}`}
        >
          {parseFloat(plan.priceMonthly).toFixed(0)} PLN / miesiac po okresie
          probnym
        </span>
      </div>
    </div>
  );
}

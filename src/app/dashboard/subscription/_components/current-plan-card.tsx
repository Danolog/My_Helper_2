"use client";

import {
  Crown,
  Zap,
  CalendarDays,
  CreditCard,
  Check,
  AlertTriangle,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type {
  SubscriptionData,
  PlanData,
  ScheduledPlanData,
  AllPlansMap,
} from "../_types";
import { formatDate, statusColor, statusLabel } from "../_types";
import { TrialNotice } from "./trial-notice";
import { PlanActions } from "./plan-actions";

interface CurrentPlanCardProps {
  subscription: SubscriptionData;
  plan: PlanData;
  allPlans: AllPlansMap;
  scheduledPlan: ScheduledPlanData;
  changePlanLoading: boolean;
  downgradeLoading: boolean;
  cancelLoading: boolean;
  cancelDowngradeLoading: boolean;
  onChangePlan: (slug: string) => Promise<void>;
  onDowngrade: (slug: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onCancelDowngrade: () => Promise<void>;
  onRefresh: () => void;
}

export function CurrentPlanCard({
  subscription,
  plan,
  allPlans,
  scheduledPlan,
  changePlanLoading,
  downgradeLoading,
  cancelLoading,
  cancelDowngradeLoading,
  onChangePlan,
  onDowngrade,
  onCancel,
  onCancelDowngrade,
  onRefresh,
}: CurrentPlanCardProps) {
  return (
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
              <CardTitle className="text-xl">Plan {plan.name}</CardTitle>
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
                {subscription.status === "trialing"
                  ? "Koniec okresu probnego"
                  : "Nastepna platnosc"}
              </p>
              <p className="text-sm text-muted-foreground">
                {subscription.status === "trialing" &&
                subscription.trialEndsAt
                  ? formatDate(subscription.trialEndsAt)
                  : formatDate(subscription.currentPeriodEnd)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg border">
            <CreditCard className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">
                {subscription.status === "trialing"
                  ? "Cena po okresie probnym"
                  : "Kwota"}
              </p>
              <p className="text-sm text-muted-foreground">
                {parseFloat(plan.priceMonthly).toFixed(2)} PLN / mies.
              </p>
            </div>
          </div>
        </div>

        {/* Trial period notice */}
        <TrialNotice
          subscription={subscription}
          plan={plan}
          changePlanLoading={changePlanLoading}
          onChangePlan={onChangePlan}
        />

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
                {subscription.currentPeriodEnd &&
                new Date(subscription.currentPeriodEnd) > new Date()
                  ? `Dostep do funkcji planu jest aktywny do ${formatDate(subscription.currentPeriodEnd)}.`
                  : "Dostep do funkcji planu zakonczyl sie."}
                {" "}Mozesz w kazdej chwili ponownie aktywowac plan.
              </p>
            </div>
          </div>
        )}

        {/* Pending downgrade notice */}
        {subscription.scheduledPlanId && scheduledPlan && (
          <PendingDowngradeNotice
            subscription={subscription}
            scheduledPlan={scheduledPlan}
            cancelDowngradeLoading={cancelDowngradeLoading}
            onCancelDowngrade={onCancelDowngrade}
          />
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
        <PlanActions
          subscription={subscription}
          plan={plan}
          allPlans={allPlans}
          changePlanLoading={changePlanLoading}
          downgradeLoading={downgradeLoading}
          cancelLoading={cancelLoading}
          onChangePlan={onChangePlan}
          onDowngrade={onDowngrade}
          onCancel={onCancel}
          onRefresh={onRefresh}
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pending downgrade notice (private to this file)                     */
/* ------------------------------------------------------------------ */

interface PendingDowngradeNoticeProps {
  subscription: SubscriptionData;
  scheduledPlan: NonNullable<ScheduledPlanData>;
  cancelDowngradeLoading: boolean;
  onCancelDowngrade: () => Promise<void>;
}

function PendingDowngradeNotice({
  subscription,
  scheduledPlan,
  cancelDowngradeLoading,
  onCancelDowngrade,
}: PendingDowngradeNoticeProps) {
  return (
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
                <AlertDialogTitle>
                  Anulowac obnizenie planu?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Twoj plan Pro pozostanie aktywny bez zmian. Zaplanowane
                  obnizenie do planu {scheduledPlan.name} zostanie anulowane.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  Nie, zachowaj obnizenie
                </AlertDialogCancel>
                <AlertDialogAction onClick={onCancelDowngrade}>
                  Tak, anuluj obnizenie
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

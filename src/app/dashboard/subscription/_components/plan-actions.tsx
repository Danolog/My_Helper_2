"use client";

import Link from "next/link";
import {
  Crown,
  Zap,
  Loader2,
  ArrowUpRight,
  XCircle,
  ArrowDownRight,
  ArrowUp,
  Sparkles,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
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
import { PLANS } from "@/lib/constants";
import type { SubscriptionData, PlanData, AllPlansMap } from "../_types";
import { formatDate } from "../_types";

interface PlanActionsProps {
  subscription: SubscriptionData;
  plan: PlanData;
  allPlans: AllPlansMap;
  changePlanLoading: boolean;
  downgradeLoading: boolean;
  cancelLoading: boolean;
  onChangePlan: (slug: string) => Promise<void>;
  onDowngrade: (slug: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRefresh: () => void;
}

export function PlanActions({
  subscription,
  plan,
  allPlans,
  changePlanLoading,
  downgradeLoading,
  cancelLoading,
  onChangePlan,
  onDowngrade,
  onCancel,
  onRefresh,
}: PlanActionsProps) {
  const isActiveOrTrialing =
    subscription.status === "active" || subscription.status === "trialing";

  return (
    <div className="flex flex-wrap gap-3 pt-4 border-t">
      {/* Upgrade: Basic -> Pro */}
      {isActiveOrTrialing && plan.slug === "basic" && (
        <UpgradeDialog
          plan={plan}
          allPlans={allPlans}
          changePlanLoading={changePlanLoading}
          onChangePlan={onChangePlan}
        />
      )}

      {/* Downgrade: Pro -> Basic (only if no pending downgrade) */}
      {isActiveOrTrialing &&
        plan.slug === "pro" &&
        !subscription.scheduledPlanId && (
          <DowngradeDialog
            subscription={subscription}
            plan={plan}
            allPlans={allPlans}
            downgradeLoading={downgradeLoading}
            onDowngrade={onDowngrade}
          />
        )}

      {/* Cancel subscription */}
      {isActiveOrTrialing && (
        <CancelDialog
          subscription={subscription}
          plan={plan}
          cancelLoading={cancelLoading}
          onCancel={onCancel}
        />
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

      <Button variant="ghost" size="sm" onClick={onRefresh}>
        <RefreshCw className="h-4 w-4 mr-2" />
        Odswiez
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Upgrade dialog                                                      */
/* ------------------------------------------------------------------ */

interface UpgradeDialogProps {
  plan: PlanData;
  allPlans: AllPlansMap;
  changePlanLoading: boolean;
  onChangePlan: (slug: string) => Promise<void>;
}

function UpgradeDialog({
  plan,
  allPlans,
  changePlanLoading,
  onChangePlan,
}: UpgradeDialogProps) {
  return (
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
                Przejdz na plan Pro i odblokuj wszystkie funkcje AI, w tym
                asystenta glosowego, biznesowego i content marketingowego.
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
                  <span className="font-medium text-primary">
                    Roznica w cenie
                  </span>
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
                      .filter(
                        (f) =>
                          !plan.features.includes(f) &&
                          f !== "Wszystko z planu Basic",
                      )
                      .map((feature, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 text-sm"
                        >
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
            onClick={() => onChangePlan("pro")}
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
  );
}

/* ------------------------------------------------------------------ */
/* Downgrade dialog                                                    */
/* ------------------------------------------------------------------ */

interface DowngradeDialogProps {
  subscription: SubscriptionData;
  plan: PlanData;
  allPlans: AllPlansMap;
  downgradeLoading: boolean;
  onDowngrade: (slug: string) => Promise<void>;
}

function DowngradeDialog({
  subscription,
  plan,
  allPlans,
  downgradeLoading,
  onDowngrade,
}: DowngradeDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={downgradeLoading}>
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
                  <span className="font-medium text-green-600">
                    Oszczedzasz
                  </span>
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
                  rozliczeniowego
                  {subscription.currentPeriodEnd
                    ? ` (${formatDate(subscription.currentPeriodEnd)})`
                    : ""}
                  . Do tego czasu zachowasz pelny dostep do funkcji Pro.
                </span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onDowngrade("basic")}
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
  );
}

/* ------------------------------------------------------------------ */
/* Cancel dialog                                                       */
/* ------------------------------------------------------------------ */

interface CancelDialogProps {
  subscription: SubscriptionData;
  plan: PlanData;
  cancelLoading: boolean;
  onCancel: () => Promise<void>;
}

function CancelDialog({
  subscription,
  plan,
  cancelLoading,
  onCancel,
}: CancelDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={cancelLoading}>
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
            onClick={onCancel}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Tak, anuluj subskrypcje
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

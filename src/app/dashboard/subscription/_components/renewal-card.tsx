"use client";

import { CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubscriptionData, PlanData, ScheduledPlanData } from "../_types";
import { formatDate } from "../_types";

interface RenewalCardProps {
  subscription: SubscriptionData;
  plan: PlanData;
  scheduledPlan: ScheduledPlanData;
  renewLoading: boolean;
  onSimulateRenewal: () => Promise<void>;
}

export function RenewalCard({
  subscription,
  plan,
  scheduledPlan,
  renewLoading,
  onSimulateRenewal,
}: RenewalCardProps) {
  return (
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
              onClick={onSimulateRenewal}
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
  );
}

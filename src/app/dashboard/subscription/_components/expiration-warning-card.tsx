"use client";

import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { planGrossText, planPriceText } from "@/lib/plan-price";
import { formatDate } from "../_types";
import type { SubscriptionData, ExpirationData } from "../_types";

interface ExpirationWarningCardProps {
  subscription: SubscriptionData;
  expirationData: ExpirationData;
}

export function ExpirationWarningCard({
  subscription,
  expirationData,
}: ExpirationWarningCardProps) {
  return (
    <Card
      className={
        expirationData.isNearExpiry
          ? "border-amber-300 dark:border-amber-700"
          : ""
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                expirationData.isNearExpiry
                  ? "bg-amber-100 dark:bg-amber-950/30"
                  : "bg-blue-100 dark:bg-blue-950/30"
              }`}
            >
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
            <span
              className={`font-bold text-lg ${
                expirationData.daysRemaining !== null &&
                expirationData.daysRemaining <= 3
                  ? "text-red-600"
                  : expirationData.isNearExpiry
                    ? "text-amber-600"
                    : "text-green-600"
              }`}
            >
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
                ? `${planGrossText(expirationData.renewalAmount)} (${planPriceText(expirationData.renewalAmount)})`
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
          <NearExpiryBanner expirationData={expirationData} />
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Near expiry warning banner                                          */
/* ------------------------------------------------------------------ */

interface NearExpiryBannerProps {
  expirationData: ExpirationData;
}

function NearExpiryBanner({ expirationData }: NearExpiryBannerProps) {
  return (
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
              ? planGrossText(expirationData.renewalAmount)
              : "-"}
          </span>
          .
        </p>
      </div>
    </div>
  );
}

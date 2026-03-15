"use client";

import {
  AlertTriangle,
  Bell,
  Clock,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubscriptionData, ExpirationData } from "../_types";
import { formatDate } from "../_types";

interface ExpirationWarningCardProps {
  subscription: SubscriptionData;
  expirationData: ExpirationData;
  renewLoading: boolean;
  simulateLoading: boolean;
  sendWarningLoading: boolean;
  onSimulateRenewal: () => Promise<void>;
  onSimulateNearExpiry: () => Promise<void>;
  onSendWarning: () => Promise<void>;
}

export function ExpirationWarningCard({
  subscription,
  expirationData,
  renewLoading,
  simulateLoading,
  sendWarningLoading,
  onSimulateRenewal,
  onSimulateNearExpiry,
  onSendWarning,
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
                ? `${parseFloat(expirationData.renewalAmount).toFixed(2)} PLN`
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
          <NearExpiryBanner
            expirationData={expirationData}
            renewLoading={renewLoading}
            onSimulateRenewal={onSimulateRenewal}
          />
        )}

        {/* Recent warnings */}
        {expirationData.recentWarnings.length > 0 && (
          <RecentWarnings warnings={expirationData.recentWarnings} />
        )}

        {/* Dev mode: Simulation controls */}
        <div className="pt-2 border-t">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Tryb deweloperski
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSimulateNearExpiry}
              disabled={simulateLoading}
            >
              {simulateLoading ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <ShieldAlert className="h-3 w-3 mr-2" />
              )}
              Symuluj wygasniecie (3 dni)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onSendWarning}
              disabled={sendWarningLoading}
            >
              {sendWarningLoading ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <Bell className="h-3 w-3 mr-2" />
              )}
              Wyslij ostrzezenie
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Near expiry warning banner                                          */
/* ------------------------------------------------------------------ */

interface NearExpiryBannerProps {
  expirationData: ExpirationData;
  renewLoading: boolean;
  onSimulateRenewal: () => Promise<void>;
}

function NearExpiryBanner({
  expirationData,
  renewLoading,
  onSimulateRenewal,
}: NearExpiryBannerProps) {
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
              ? `${parseFloat(expirationData.renewalAmount).toFixed(2)} PLN`
              : "-"}
          </span>
          .
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
          >
            <CreditCard className="h-3 w-3 mr-2" />
            Sprawdz metode platnosci
          </Button>
          <Button
            size="sm"
            onClick={onSimulateRenewal}
            disabled={renewLoading}
          >
            {renewLoading ? (
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-2" />
            )}
            Odnow teraz
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recent warnings list                                                */
/* ------------------------------------------------------------------ */

interface RecentWarningsProps {
  warnings: ExpirationData["recentWarnings"];
}

function RecentWarnings({ warnings }: RecentWarningsProps) {
  return (
    <div>
      <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        <Bell className="h-3.5 w-3.5" />
        Ostatnie ostrzezenia
      </h4>
      <div className="space-y-2">
        {warnings.map((warning) => (
          <div
            key={warning.id}
            className="flex items-start gap-3 p-3 rounded-lg border text-sm"
          >
            <div
              className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                warning.type === "email"
                  ? "bg-blue-100 text-blue-700"
                  : warning.type === "push"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-gray-100 text-gray-700"
              }`}
            >
              {warning.type === "email"
                ? "Email"
                : warning.type === "push"
                  ? "Push"
                  : warning.type.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground line-clamp-2">
                {warning.message}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {warning.sentAt
                  ? formatDate(warning.sentAt)
                  : formatDate(warning.createdAt)}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                warning.status === "sent"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : warning.status === "pending"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-red-50 text-red-700 border-red-200"
              }
            >
              {warning.status === "sent"
                ? "Wyslano"
                : warning.status === "pending"
                  ? "Oczekuje"
                  : "Blad"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { AlertTriangle, Timer, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { isPlanPurchaseOpen } from "@/lib/features";

export function DashboardTrialBanner() {
  const { isTrialing, trialDaysRemaining } = useSubscription();

  if (!isTrialing || trialDaysRemaining === null) return null;

  const purchaseOpen = isPlanPurchaseOpen();

  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border mb-6 ${
      trialDaysRemaining <= 3
        ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
        : "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
    }`}>
      {trialDaysRemaining <= 3 ? (
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
      ) : (
        <Timer className="h-5 w-5 text-blue-600 shrink-0" />
      )}
      <div className="flex-1">
        <p className={`text-sm font-medium ${
          trialDaysRemaining <= 3
            ? "text-amber-800 dark:text-amber-200"
            : "text-blue-800 dark:text-blue-200"
        }`}>
          {trialDaysRemaining <= 3
            ? `Okres probny konczy sie za ${trialDaysRemaining} ${trialDaysRemaining === 1 ? "dzien" : "dni"}!`
            : `Okres probny - pozostalo ${trialDaysRemaining} ${trialDaysRemaining === 1 ? "dzien" : "dni"}`
          }
        </p>
        <p className={`text-xs mt-0.5 ${
          trialDaysRemaining <= 3
            ? "text-amber-600 dark:text-amber-300"
            : "text-blue-600 dark:text-blue-300"
        }`}>
          {trialDaysRemaining <= 3
            ? purchaseOpen
              ? "Wykup subskrypcję, aby zachować pełny dostęp po okresie próbnym."
              : "Po zakończeniu okresu próbnego panel przejdzie w tryb tylko do odczytu."
            : // Bez liczby dni: salon może mieć indywidualną datę końca okresu próbnego.
              "Korzystasz z pełnych funkcji w okresie próbnym."
          }
        </p>
      </div>
      <Button asChild size="sm" variant={trialDaysRemaining <= 3 ? "default" : "outline"}>
        <Link href="/dashboard/subscription">
          <CreditCard className="h-3 w-3 mr-2" />
          {trialDaysRemaining <= 3
            ? purchaseOpen ? "Wykup teraz" : "Szczegóły"
            : "Zarzadzaj"}
        </Link>
      </Button>
    </div>
  );
}

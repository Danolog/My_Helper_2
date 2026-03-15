"use client";

import {
  Crown,
  Zap,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sendVerificationEmail } from "@/lib/auth-client";
import type { Plan } from "../_hooks/use-registration";

interface StepConfirmationProps {
  email: string;
  selectedPlan: string | null;
  selectedPlanData: Plan | undefined;
  onNavigateToDashboard: () => void;
  onSetError: (error: string) => void;
}

export function StepConfirmation({
  email,
  selectedPlan,
  selectedPlanData,
  onNavigateToDashboard,
  onSetError,
}: StepConfirmationProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Konto utworzone!</CardTitle>
        <CardDescription>Jeszcze jeden krok...</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 p-4 text-center">
          <h3 className="font-semibold text-green-800 dark:text-green-200 mb-2">
            Konto zostalo utworzone pomyslnie!
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300">
            Wyslalismy email weryfikacyjny na adres{" "}
            <strong>{email}</strong>. Kliknij link w wiadomosci, aby
            aktywowac konto.
          </p>
        </div>

        {selectedPlanData && (
          <div className="rounded-lg border p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">
              Wybrany plan
            </p>
            <div className="flex items-center justify-center gap-2">
              {selectedPlan === "pro" ? (
                <Crown className="h-5 w-5 text-primary" />
              ) : (
                <Zap className="h-5 w-5 text-blue-600" />
              )}
              <span className="font-semibold text-lg">
                {selectedPlanData.name}
              </span>
              <span className="text-muted-foreground">
                - {parseFloat(selectedPlanData.priceMonthly).toFixed(0)}{" "}
                PLN/mies.
              </span>
            </div>
          </div>
        )}

        <Button
          className="w-full"
          onClick={onNavigateToDashboard}
        >
          Przejdz do aplikacji
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>

        <div className="text-center text-sm text-muted-foreground">
          Nie otrzymales emaila?{" "}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={async () => {
              try {
                await sendVerificationEmail({
                  email,
                  callbackURL: "/dashboard",
                });
                onSetError("");
              } catch {
                onSetError("Nie udalo sie ponownie wyslac emaila");
              }
            }}
          >
            Wyslij ponownie
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

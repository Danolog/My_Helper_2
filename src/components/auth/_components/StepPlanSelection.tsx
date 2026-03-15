"use client";

import Link from "next/link";
import {
  Check,
  Crown,
  Zap,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TRIAL_DAYS } from "@/lib/constants";
import type { Plan } from "../_hooks/use-registration";

interface StepPlanSelectionProps {
  selectedPlan: string | null;
  plansLoading: boolean;
  basicPlan: Plan | undefined;
  proPlan: Plan | undefined;
  onSelectPlan: (slug: string) => void;
  onContinue: () => void;
}

export function StepPlanSelection({
  selectedPlan,
  plansLoading,
  basicPlan,
  proPlan,
  onSelectPlan,
  onContinue,
}: StepPlanSelectionProps) {
  return (
    <div className="w-full max-w-3xl">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
            1
          </div>
          <span className="text-sm font-medium">Wybierz plan</span>
        </div>
        <div className="w-8 h-px bg-border" />
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-semibold text-sm">
            2
          </div>
          <span className="text-sm text-muted-foreground">Dane konta</span>
        </div>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Wybierz plan dla siebie
        </h1>
        <p className="text-muted-foreground">
          Zacznij od {TRIAL_DAYS}-dniowego okresu probnego bez zobowiazan
        </p>
      </div>

      {plansLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Basic Plan Card */}
            {basicPlan && (
              <button
                type="button"
                onClick={() => onSelectPlan("basic")}
                className="text-left"
              >
                <Card
                  className={`relative flex flex-col h-full transition-all cursor-pointer hover:shadow-lg ${
                    selectedPlan === "basic"
                      ? "border-2 border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900 shadow-lg"
                      : "border-2 border-transparent hover:border-muted-foreground/20"
                  }`}
                >
                  {selectedPlan === "basic" && (
                    <div className="absolute top-3 right-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white">
                        <Check className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950">
                        <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <CardTitle className="text-xl">
                        {basicPlan.name}
                      </CardTitle>
                    </div>
                    <CardDescription>
                      Pelne zarzadzanie salonem bez narzedzi AI
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <div className="mb-4">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold">
                          {parseFloat(basicPlan.priceMonthly).toFixed(0)}
                        </span>
                        <span className="text-muted-foreground">
                          PLN / mies.
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 flex-1">
                      {basicPlan.features.slice(0, 5).map((feature, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                          <span className="text-sm">{feature}</span>
                        </div>
                      ))}
                      {basicPlan.features.length > 5 && (
                        <p className="text-xs text-muted-foreground pl-6">
                          +{basicPlan.features.length - 5} wiecej funkcji
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </button>
            )}

            {/* Pro Plan Card */}
            {proPlan && (
              <button
                type="button"
                onClick={() => onSelectPlan("pro")}
                className="text-left"
              >
                <Card
                  className={`relative flex flex-col h-full transition-all cursor-pointer hover:shadow-lg ${
                    selectedPlan === "pro"
                      ? "border-2 border-primary ring-2 ring-primary/20 shadow-lg"
                      : "border-2 border-transparent hover:border-muted-foreground/20"
                  }`}
                >
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="px-3 py-0.5 text-xs shadow-sm">
                      Najpopularniejszy
                    </Badge>
                  </div>
                  {selectedPlan === "pro" && (
                    <div className="absolute top-3 right-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground">
                        <Check className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                  <CardHeader className="pb-3 pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                        <Crown className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-xl">
                        {proPlan.name}
                      </CardTitle>
                    </div>
                    <CardDescription>
                      Pelna funkcjonalnosc z asystentem AI
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <div className="mb-4">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold">
                          {parseFloat(proPlan.priceMonthly).toFixed(0)}
                        </span>
                        <span className="text-muted-foreground">
                          PLN / mies.
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 flex-1">
                      {proPlan.features.slice(0, 5).map((feature, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                          <span className="text-sm font-medium">
                            {feature}
                          </span>
                        </div>
                      ))}
                      {proPlan.features.length > 5 && (
                        <p className="text-xs text-muted-foreground pl-6">
                          +{proPlan.features.length - 5} wiecej funkcji
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </button>
            )}
          </div>

          <div className="flex flex-col items-center gap-4">
            <Button
              size="lg"
              onClick={onContinue}
              disabled={!selectedPlan}
              className="min-w-[200px]"
            >
              Dalej
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Masz juz konto?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Zaloguj sie
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

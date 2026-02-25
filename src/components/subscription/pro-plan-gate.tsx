"use client";

import Link from "next/link";
import { Crown, Sparkles, ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/use-subscription";
import { PLANS } from "@/lib/constants";
import { Skeleton } from "@/components/ui/skeleton";

type ProPlanGateProps = {
  /** The name of the blocked feature (e.g., "Asystent AI") */
  featureName: string;
  /** Description of what the feature does */
  featureDescription: string;
  /** List of benefits available with Pro plan */
  proBenefits?: string[];
  /** Content to show when user has Pro plan */
  children: React.ReactNode;
};

/**
 * A gating component that blocks access to Pro-only features for Basic plan users.
 * Shows an upgrade prompt when the user is on Basic plan.
 * Renders children normally when user has Pro plan.
 */
export function ProPlanGate({
  featureName,
  featureDescription,
  proBenefits = [],
  children,
}: ProPlanGateProps) {
  const { isProPlan, loading } = useSubscription();

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isProPlan) {
    return <>{children}</>;
  }

  // Basic plan - show upgrade prompt
  return (
    <div className="container mx-auto p-6">
      <div className="max-w-2xl mx-auto">
        <Card className="border-2 border-dashed border-muted-foreground/30">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-2">
              <Badge variant="secondary" className="gap-1">
                <Crown className="h-3 w-3" />
                Tylko Plan Pro
              </Badge>
            </div>
            <CardTitle className="text-2xl">{featureName}</CardTitle>
            <CardDescription className="text-base">
              {featureDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {proBenefits.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Co zyskujesz z Planem Pro:
                </h3>
                <ul className="space-y-2">
                  {proBenefits.map((benefit, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Przejdz na Plan Pro, aby odblokować {featureName.toLowerCase()} i
                wszystkie funkcje AI.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild size="lg" className="gap-2">
                  <Link href="/dashboard/subscription">
                    <Crown className="h-4 w-4" />
                    Zmien na Pro
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/pricing">Porownaj plany</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Plan Pro: {PLANS.pro.priceMonthly} PLN/miesiac — pelna funkcjonalnosc z AI
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

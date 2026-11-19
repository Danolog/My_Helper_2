"use client";

import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubscription } from "@/hooks/use-subscription";

type ProPlanGateProps = {
  /** The name of the blocked feature (e.g., "Asystent AI") */
  featureName: string;
  /** Description of what the feature does */
  featureDescription: string;
  /** List of feature benefits; accepted from callers but not rendered */
  proBenefits?: string[];
  /** Content to show when user has Pro plan */
  children: React.ReactNode;
};

/**
 * A gating component that blocks access to AI features when `isProPlan` is false.
 * Shows the feature name, its description and a message that AI features are
 * not available in the current plan.
 * Renders children normally when `isProPlan` is true.
 */
export function ProPlanGate({
  featureName,
  featureDescription,
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

  // No Pro plan - show the feature and the unavailability message
  return (
    <div className="container mx-auto p-6">
      <div className="max-w-2xl mx-auto">
        <Card className="border-2 border-dashed border-muted-foreground/30">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl">{featureName}</CardTitle>
            <CardDescription className="text-base">
              {featureDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Funkcje AI nie są jeszcze dostępne w Twoim planie.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

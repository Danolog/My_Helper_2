"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubscriptionData } from "../_types";

interface TechnicalInfoCardProps {
  subscription: SubscriptionData;
}

export function TechnicalInfoCard({ subscription }: TechnicalInfoCardProps) {
  if (!subscription.stripeSubscriptionId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Informacje techniczne
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">ID subskrypcji</span>
          <code className="text-xs bg-muted px-2 py-0.5 rounded">
            {subscription.stripeSubscriptionId}
          </code>
        </div>
        {subscription.stripeCustomerId && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID klienta</span>
            <code className="text-xs bg-muted px-2 py-0.5 rounded">
              {subscription.stripeCustomerId}
            </code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

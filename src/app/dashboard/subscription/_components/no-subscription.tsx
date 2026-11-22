"use client";

import Link from "next/link";
import { CreditCard, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isPlanPurchaseOpen } from "@/lib/features";
import { PURCHASE_CLOSED_CONTACT_TEXT } from "./trial-notice";

export function NoSubscription() {
  // Przy zamkniętym zakupie cennik nie ma przycisku zakupu dla zalogowanego,
  // więc odnośnik do niego niczego by nie załatwił.
  const purchaseOpen = isPlanPurchaseOpen();

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <CardTitle className="text-xl">Brak aktywnej subskrypcji</CardTitle>
        <CardDescription className="text-base">
          Nie masz jeszcze aktywnego planu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        {purchaseOpen ? (
          <Button asChild size="lg">
            <Link href="/pricing">
              Wybierz plan
              <ArrowUpRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        ) : (
          <p
            className="text-sm text-center text-muted-foreground"
            data-testid="no-subscription-purchase-closed"
          >
            {PURCHASE_CLOSED_CONTACT_TEXT}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

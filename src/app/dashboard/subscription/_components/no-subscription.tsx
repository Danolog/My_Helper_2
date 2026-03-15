"use client";

import Link from "next/link";
import { CreditCard, ArrowUpRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function NoSubscription() {
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
          Nie masz jeszcze aktywnego planu. Wybierz plan, ktory najlepiej
          odpowiada Twoim potrzebom.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        <Button asChild size="lg">
          <Link href="/pricing">
            Wybierz plan
            <ArrowUpRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

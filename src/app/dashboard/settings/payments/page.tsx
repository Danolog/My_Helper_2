"use client";

import Link from "next/link";
import { ArrowLeft, CreditCard } from "lucide-react";
import { RoleGate } from "@/components/dashboard/role-gate";
import { Button } from "@/components/ui/button";
import { BlikDepositSection } from "./_components/blik-deposit-section";

export default function PaymentSettingsPage() {
  return (
    <RoleGate allow={["owner"]}>
      <PaymentSettingsPageInner />
    </RoleGate>
  );
}

function PaymentSettingsPageInner() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/settings" aria-label="Powrót do ustawień">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CreditCard className="w-8 h-8 text-primary" aria-hidden="true" />
            Płatności i zadatki
          </h1>
          <p className="text-muted-foreground mt-1">
            Ustawienia wpłat zadatków od klientów
          </p>
        </div>
      </div>

      <BlikDepositSection />
    </div>
  );
}

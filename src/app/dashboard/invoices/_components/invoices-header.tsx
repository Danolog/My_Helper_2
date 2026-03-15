"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InvoicesHeader() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-bold" data-testid="invoices-title">
          Historia faktur
        </h1>
        <p className="text-muted-foreground">
          Przegladaj wszystkie wystawione faktury i rachunki
        </p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinanceHeader() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-bold">Finanse - Prowizje</h1>
        <p className="text-muted-foreground">
          Zarzadzaj prowizjami pracownikow
        </p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SubscriptionHeader() {
  return (
    <div className="flex items-center gap-4 mb-8">
      <Button variant="outline" size="sm" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Dashboard
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-bold">Subskrypcja</h1>
        <p className="text-muted-foreground">
          Zarzadzaj swoim planem i platnosciami
        </p>
      </div>
    </div>
  );
}

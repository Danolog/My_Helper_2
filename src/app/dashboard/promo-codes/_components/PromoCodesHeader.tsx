"use client";

import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PromoCodesHeaderProps {
  onCreateClick: () => void;
}

export function PromoCodesHeader({ onCreateClick }: PromoCodesHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="outline" size="sm" asChild>
        <Link href="/dashboard/promotions">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Promocje
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-3xl font-bold">Kody promocyjne</h1>
        <p className="text-muted-foreground">
          Generuj i zarzadzaj kodami rabatowymi
        </p>
      </div>
      <Button onClick={onCreateClick}>
        <Plus className="w-4 h-4 mr-2" />
        Generuj kod
      </Button>
    </div>
  );
}

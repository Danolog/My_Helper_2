"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComparisonData } from "../_types";

interface YearlyComparisonHeaderProps {
  comparisonData: ComparisonData | null;
  onExportPDF: () => void;
}

export function YearlyComparisonHeader({
  comparisonData,
  onExportPDF,
}: YearlyComparisonHeaderProps) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-purple-600" />
          Porownanie roczne
        </h1>
        <p className="text-muted-foreground text-sm">
          Porownaj metryki salonu rok do roku
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onExportPDF}
        disabled={!comparisonData}
      >
        <FileText className="h-4 w-4 mr-2" />
        Eksport PDF
      </Button>
    </div>
  );
}

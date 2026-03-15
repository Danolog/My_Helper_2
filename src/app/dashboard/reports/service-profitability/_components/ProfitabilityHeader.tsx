"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  PieChart,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "../_types";

interface ProfitabilityHeaderProps {
  reportData: ReportData | null;
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function ProfitabilityHeader({
  reportData,
  onExportPDF,
  onExportCSV,
}: ProfitabilityHeaderProps) {
  const exportDisabled =
    !reportData || reportData.summary.totalAppointments === 0;

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PieChart className="h-6 w-6 text-emerald-600" />
          Rentownosc uslug
        </h1>
        <p className="text-muted-foreground text-sm">
          Marze zysku na uslugach - przychod minus koszty
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onExportPDF}
          disabled={exportDisabled}
        >
          <FileText className="h-4 w-4 mr-2" />
          Eksport PDF
        </Button>
        <Button
          variant="outline"
          onClick={onExportCSV}
          disabled={exportDisabled}
        >
          <Download className="h-4 w-4 mr-2" />
          Eksport CSV
        </Button>
      </div>
    </div>
  );
}

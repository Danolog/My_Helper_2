"use client";

import Link from "next/link";
import { ArrowLeft, Download, BarChart3, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "../_types";

interface ReportHeaderProps {
  reportData: ReportData | null;
  onExportPDF: () => void;
  onExportCSV: () => void;
}

export function ReportHeader({
  reportData,
  onExportPDF,
  onExportCSV,
}: ReportHeaderProps) {
  const hasData = reportData && reportData.summary.length > 0;

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-emerald-600" />
          Zysk/Strata materialow
        </h1>
        <p className="text-muted-foreground text-sm">
          Koszt materialow vs przychod z uslug - analiza rentownosci produktow
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onExportPDF}
          disabled={!hasData}
        >
          <FileText className="h-4 w-4 mr-2" />
          Eksport PDF
        </Button>
        <Button
          variant="outline"
          onClick={onExportCSV}
          disabled={!hasData}
        >
          <Download className="h-4 w-4 mr-2" />
          Eksport CSV
        </Button>
      </div>
    </div>
  );
}

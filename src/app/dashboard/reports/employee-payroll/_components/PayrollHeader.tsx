"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Wallet,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "../_types";

interface PayrollHeaderProps {
  reportData: ReportData | null;
  onExportPDF: () => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
}

export function PayrollHeader({
  reportData,
  onExportPDF,
  onExportExcel,
  onExportCSV,
}: PayrollHeaderProps) {
  const exportDisabled =
    !reportData || reportData.summary.totalCompletedAppointments === 0;

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6 text-emerald-600" />
          Raport wynagrodzen
        </h1>
        <p className="text-muted-foreground text-sm">
          Podsumowanie prowizji, godzin pracy i wynagrodzen pracownikow
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
          onClick={onExportExcel}
          disabled={exportDisabled}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Eksport Excel
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

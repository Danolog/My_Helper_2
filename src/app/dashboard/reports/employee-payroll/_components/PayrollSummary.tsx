"use client";

import {
  Users,
  Clock,
  DollarSign,
  Banknote,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface PayrollSummaryProps {
  reportData: ReportData;
}

export function PayrollSummary({ reportData }: PayrollSummaryProps) {
  const { summary, byEmployee } = reportData;

  return (
    <>
      {/* Primary summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Calkowita prowizja
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Banknote className="h-5 w-5 text-emerald-600" />
              {parseFloat(summary.totalCommission).toFixed(2)}{" "}
              PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Do wyplaty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              {parseFloat(summary.unpaidCommission).toFixed(2)}{" "}
              PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Wyplacona prowizja
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {parseFloat(summary.paidCommission).toFixed(2)}{" "}
              PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Czas pracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Clock className="h-5 w-5 text-blue-600" />
              {summary.totalHoursWorked}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalCompletedAppointments} wizyt
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary summary row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Calkowity przychod
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <DollarSign className="h-5 w-5 text-green-600" />
              {parseFloat(summary.totalRevenue).toFixed(2)} PLN
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Przychod wygenerowany przez pracownikow
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Liczba pracownikow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <Users className="h-5 w-5 text-purple-600" />
              {byEmployee.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pracownicy z ukonczonym wizytami w okresie
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

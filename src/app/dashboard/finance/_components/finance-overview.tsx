"use client";

import {
  DollarSign,
  Users,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommissionsData } from "../_types";

interface FinanceOverviewProps {
  data: CommissionsData | null;
  loading: boolean;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRefresh: () => void;
}

export function FinanceOverview({
  data,
  loading,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onRefresh,
}: FinanceOverviewProps) {
  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label>Od daty</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
                data-testid="date-from-input"
              />
            </div>
            <div>
              <Label>Do daty</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                data-testid="date-to-input"
              />
            </div>
            <Button
              onClick={onRefresh}
              variant="outline"
              data-testid="refresh-btn"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Odswiez
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Laczne prowizje
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold"
                data-testid="total-commissions"
              >
                {data.summary.totalCommissions.toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Liczba prowizji
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold"
                data-testid="commission-count"
              >
                {data.summary.commissionCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pracownicy z prowizja
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="text-2xl font-bold"
                data-testid="employee-count"
              >
                {data.summary.employeeCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Employee Totals */}
      {data && data.employeeTotals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Prowizje wg pracownikow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="employee-totals-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">
                      Pracownik
                    </th>
                    <th className="text-right p-3 font-medium">
                      Liczba wizyt
                    </th>
                    <th className="text-right p-3 font-medium">
                      Sredni %
                    </th>
                    <th className="text-right p-3 font-medium">
                      Domyslna stawka
                    </th>
                    <th className="text-right p-3 font-medium">
                      Suma prowizji
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.employeeTotals.map((emp) => (
                    <tr
                      key={emp.employeeId}
                      className="border-b hover:bg-muted/50"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: emp.color || "#6b7280",
                            }}
                          />
                          <span className="font-medium">
                            {emp.firstName} {emp.lastName}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        {emp.commissionCount}
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant="secondary">
                          {parseFloat(emp.avgPercentage).toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant="outline">
                          {emp.commissionRate
                            ? `${parseFloat(emp.commissionRate).toFixed(0)}%`
                            : "50%"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {parseFloat(emp.totalAmount).toFixed(2)} PLN
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && data && data.employeeTotals.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Brak prowizji</p>
            <p className="text-sm">
              Prowizje pojawia sie po zakonczeniu wizyt z przypisanym
              pracownikiem.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import {
  CalendarDays,
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

interface FinanceDetailsProps {
  data: CommissionsData | null;
  loading: boolean;
  dateFrom: string;
  dateTo: string;
  selectedEmployee: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSelectedEmployeeChange: (value: string) => void;
  onFilter: () => void;
}

export function FinanceDetails({
  data,
  loading,
  dateFrom,
  dateTo,
  selectedEmployee,
  onDateFromChange,
  onDateToChange,
  onSelectedEmployeeChange,
  onFilter,
}: FinanceDetailsProps) {
  return (
    <div className="space-y-6">
      {/* Employee Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label>Filtruj wg pracownika</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={selectedEmployee}
                onChange={(e) => onSelectedEmployeeChange(e.target.value)}
                data-testid="employee-filter"
              >
                <option value="">Wszyscy pracownicy</option>
                {data?.employeeTotals.map((emp) => (
                  <option key={emp.employeeId} value={emp.employeeId}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Od daty</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
              />
            </div>
            <div>
              <Label>Do daty</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
              />
            </div>
            <Button onClick={onFilter} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Filtruj
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Commission Detail Table */}
      {data && data.commissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Prowizje za wizyty ({data.commissions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="commissions-detail-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Data</th>
                    <th className="text-left p-3 font-medium">
                      Pracownik
                    </th>
                    <th className="text-left p-3 font-medium">Usluga</th>
                    <th className="text-left p-3 font-medium">Klient</th>
                    <th className="text-right p-3 font-medium">
                      Cena uslugi
                    </th>
                    <th className="text-right p-3 font-medium">
                      Prowizja %
                    </th>
                    <th className="text-right p-3 font-medium">
                      Kwota prowizji
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.commissions.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b hover:bg-muted/50"
                    >
                      <td className="p-3">
                        {c.appointmentDate
                          ? new Date(c.appointmentDate).toLocaleDateString(
                              "pl-PL",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )
                          : new Date(c.createdAt).toLocaleDateString(
                              "pl-PL",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor:
                                c.employeeColor || "#6b7280",
                            }}
                          />
                          {c.employeeFirstName} {c.employeeLastName}
                        </div>
                      </td>
                      <td className="p-3">
                        {c.serviceName || "-"}
                      </td>
                      <td className="p-3">
                        {c.clientFirstName
                          ? `${c.clientFirstName} ${c.clientLastName}`
                          : "-"}
                      </td>
                      <td className="p-3 text-right">
                        {c.servicePrice
                          ? `${parseFloat(c.servicePrice).toFixed(2)} PLN`
                          : "-"}
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant="secondary">
                          {c.percentage
                            ? `${parseFloat(c.percentage).toFixed(0)}%`
                            : "-"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {parseFloat(c.amount).toFixed(2)} PLN
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-bold">
                    <td colSpan={6} className="p-3 text-right">
                      RAZEM:
                    </td>
                    <td
                      className="p-3 text-right"
                      data-testid="detail-total"
                    >
                      {data.summary.totalCommissions.toFixed(2)} PLN
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && data && data.commissions.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CalendarDays className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Brak prowizji do wyswietlenia</p>
            <p className="text-sm">
              Sprobuj zmienic zakres dat lub filtr pracownika.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

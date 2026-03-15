"use client";

import {
  Percent,
  Settings,
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
import type { EmployeeRate } from "../_types";

interface FinanceSettingsProps {
  employeeRates: EmployeeRate[];
  ratesLoading: boolean;
  onEditRate: (emp: EmployeeRate) => void;
}

export function FinanceSettings({
  employeeRates,
  ratesLoading,
  onEditRate,
}: FinanceSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            Domyslne stawki prowizji
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Ustaw domyslny procent prowizji dla kazdego pracownika. Ta
            stawka bedzie automatycznie stosowana przy konczeniu wizyt.
          </p>
          {ratesLoading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : employeeRates.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              Brak pracownikow
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="rates-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">
                      Pracownik
                    </th>
                    <th className="text-left p-3 font-medium">Rola</th>
                    <th className="text-right p-3 font-medium">
                      Stawka prowizji
                    </th>
                    <th className="text-right p-3 font-medium">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRates.map((emp) => (
                    <tr
                      key={emp.id}
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
                      <td className="p-3">
                        <Badge variant="outline">
                          {emp.role === "owner"
                            ? "Wlasciciel"
                            : emp.role === "receptionist"
                              ? "Recepcja"
                              : "Pracownik"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Badge
                          variant="secondary"
                          className="text-base"
                          data-testid={`rate-${emp.id}`}
                        >
                          {emp.commissionRate
                            ? `${parseFloat(emp.commissionRate).toFixed(0)}%`
                            : "50%"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditRate(emp)}
                          data-testid={`edit-rate-${emp.id}`}
                        >
                          <Settings className="h-3.5 w-3.5 mr-1" />
                          Zmien
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

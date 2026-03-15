"use client";

import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";
import { getRateColor, getRateBadge } from "../_types";

interface EmployeeTabProps {
  reportData: ReportData;
}

export function EmployeeTab({ reportData }: EmployeeTabProps) {
  if (reportData.byEmployee.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Anulacje wg pracownika
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Anulacje wg pracownika
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-2 font-medium">Pracownik</th>
                <th className="text-right py-3 px-2 font-medium">
                  Laczne wizyty
                </th>
                <th className="text-right py-3 px-2 font-medium">Anulowane</th>
                <th className="text-right py-3 px-2 font-medium">
                  Nieobecnosci
                </th>
                <th className="text-right py-3 px-2 font-medium">Wskaznik</th>
              </tr>
            </thead>
            <tbody>
              {reportData.byEmployee.map((emp) => (
                <tr
                  key={emp.employeeId}
                  className="border-b hover:bg-muted/50"
                >
                  <td className="py-3 px-2 font-medium">
                    {emp.employeeName}
                  </td>
                  <td className="py-3 px-2 text-right">{emp.total}</td>
                  <td className="py-3 px-2 text-right">{emp.cancelled}</td>
                  <td className="py-3 px-2 text-right">{emp.noShow}</td>
                  <td className="py-3 px-2 text-right">
                    <Badge variant={getRateBadge(emp.rate)}>
                      <span className={getRateColor(emp.rate)}>
                        {emp.rate}%
                      </span>
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

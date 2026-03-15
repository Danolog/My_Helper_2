"use client";

import React from "react";
import {
  Users,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";

interface PayrollTableProps {
  reportData: ReportData;
  expandedEmployee: string | null;
  onToggleExpand: (employeeId: string) => void;
}

export function PayrollTable({
  reportData,
  expandedEmployee,
  onToggleExpand,
}: PayrollTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Wynagrodzenia wg pracownika
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reportData.byEmployee.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
            <p className="text-sm mt-1">
              Zmien zakres dat lub sprawdz czy istnieja ukonczone wizyty
              z prowizjami
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">
                    Pracownik
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Wizyty
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Czas pracy
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychod
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Prowizja
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Wyplacona
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Do wyplaty
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Stawka
                  </th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {reportData.byEmployee.map((emp) => (
                  <React.Fragment key={emp.employeeId}>
                    <tr
                      className="border-b hover:bg-muted/50 cursor-pointer"
                      onClick={() =>
                        onToggleExpand(emp.employeeId)
                      }
                    >
                      <td className="py-3 px-2 font-medium">
                        {emp.employeeName}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {emp.completedAppointments}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {emp.hoursWorked}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {parseFloat(emp.totalRevenue).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-emerald-700">
                        {parseFloat(emp.totalCommission).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right text-green-600">
                        {parseFloat(emp.paidCommission).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right">
                        {parseFloat(emp.unpaidCommission) > 0 ? (
                          <Badge variant="outline" className="text-orange-600 border-orange-300">
                            {parseFloat(emp.unpaidCommission).toFixed(2)}{" "}
                            PLN
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            0.00 PLN
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {parseFloat(emp.avgCommissionRate).toFixed(1)}%
                      </td>
                      <td className="py-3 px-2">
                        {emp.services.length > 0 && (
                          expandedEmployee === emp.employeeId ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )
                        )}
                      </td>
                    </tr>
                    {/* Service breakdown (expanded) */}
                    {expandedEmployee === emp.employeeId &&
                      emp.services.length > 0 && (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <div className="bg-muted/30 px-6 py-3 border-b">
                              <p className="text-xs font-medium text-muted-foreground mb-2">
                                Uslugi wykonane przez{" "}
                                {emp.employeeName}:
                              </p>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-muted">
                                    <th className="text-left py-1 px-2 font-medium">
                                      Usluga
                                    </th>
                                    <th className="text-right py-1 px-2 font-medium">
                                      Liczba
                                    </th>
                                    <th className="text-right py-1 px-2 font-medium">
                                      Przychod
                                    </th>
                                    <th className="text-right py-1 px-2 font-medium">
                                      Prowizja
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {emp.services.map((svc) => (
                                    <tr
                                      key={svc.serviceId}
                                      className="border-b border-muted/50"
                                    >
                                      <td className="py-1 px-2">
                                        {svc.serviceName}
                                      </td>
                                      <td className="py-1 px-2 text-right">
                                        {svc.count}
                                      </td>
                                      <td className="py-1 px-2 text-right">
                                        {parseFloat(
                                          svc.revenue
                                        ).toFixed(2)}{" "}
                                        PLN
                                      </td>
                                      <td className="py-1 px-2 text-right text-emerald-700">
                                        {parseFloat(
                                          svc.commission
                                        ).toFixed(2)}{" "}
                                        PLN
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-3 px-2">RAZEM</td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.totalCompletedAppointments}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.totalHoursWorked}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {parseFloat(
                      reportData.summary.totalRevenue
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right text-emerald-700">
                    {parseFloat(
                      reportData.summary.totalCommission
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right text-green-600">
                    {parseFloat(
                      reportData.summary.paidCommission
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right text-orange-600">
                    {parseFloat(
                      reportData.summary.unpaidCommission
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right"></td>
                  <td className="py-3 px-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankIcon, renderStars } from "../_types";
import type { ReportData } from "../_types";

interface PopularityTableProps {
  reportData: ReportData;
}

export function PopularityTable({ reportData }: PopularityTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Szczegolowy ranking
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reportData.employees.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">#</th>
                  <th className="text-left py-3 px-2 font-medium">
                    Pracownik
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Rezerwacje
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Ukonczone
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Unikalni klienci
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Powracajacy
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Retencja
                  </th>
                  <th className="text-center py-3 px-2 font-medium">
                    Ocena
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychod
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Udzial
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.employees.map((emp) => (
                  <tr
                    key={emp.employeeId}
                    className="border-b hover:bg-muted/50"
                  >
                    <td className="py-3 px-2">
                      <div className="flex items-center">
                        {getRankIcon(emp.rank)}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: emp.color || "#3b82f6",
                          }}
                        />
                        <span className="font-medium">
                          {emp.employeeName}
                        </span>
                      </div>
                      {emp.topServices.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Top:{" "}
                          {emp.topServices
                            .map((s) => `${s.name} (${s.count})`)
                            .join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right font-medium">
                      {emp.totalBookings}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {emp.completedBookings}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {emp.uniqueClients}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {emp.returningClients}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span
                        className={
                          parseFloat(emp.retentionRate) >= 50
                            ? "text-green-600 font-medium"
                            : parseFloat(emp.retentionRate) >= 25
                              ? "text-yellow-600"
                              : "text-red-500"
                        }
                      >
                        {emp.retentionRate}%
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex flex-col items-center gap-0.5">
                        {emp.reviewCount > 0 ? (
                          <>
                            {renderStars(parseFloat(emp.avgRating))}
                            <span className="text-xs text-muted-foreground">
                              {emp.avgRating} ({emp.reviewCount})
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Brak opinii
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right font-medium text-green-700">
                      {parseFloat(emp.revenue).toFixed(2)} PLN
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-12 bg-muted rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full"
                            style={{
                              width: `${Math.min(
                                parseFloat(emp.bookingShare),
                                100
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs">
                          {emp.bookingShare}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-3 px-2" colSpan={2}>
                    RAZEM
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.totalBookings}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.employees.reduce(
                      (sum, e) => sum + e.completedBookings,
                      0
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.employees.reduce(
                      (sum, e) => sum + e.uniqueClients,
                      0
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.employees.reduce(
                      (sum, e) => sum + e.returningClients,
                      0
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.avgRetentionRate}%
                  </td>
                  <td className="py-3 px-2 text-center">
                    {parseFloat(reportData.summary.avgRating).toFixed(1)}
                  </td>
                  <td className="py-3 px-2 text-right text-green-700">
                    {parseFloat(reportData.summary.totalRevenue).toFixed(
                      2
                    )}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

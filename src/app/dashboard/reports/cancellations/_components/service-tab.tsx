"use client";

import { Scissors } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";
import { getRateColor, getRateBadge } from "../_types";

interface ServiceTabProps {
  reportData: ReportData;
}

export function ServiceTab({ reportData }: ServiceTabProps) {
  if (reportData.byService.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Anulacje wg uslugi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Scissors className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
          <Scissors className="h-5 w-5" />
          Anulacje wg uslugi
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-2 font-medium">Usluga</th>
                <th className="text-right py-3 px-2 font-medium">
                  Laczne wizyty
                </th>
                <th className="text-right py-3 px-2 font-medium">Anulowane</th>
                <th className="text-right py-3 px-2 font-medium">
                  Nieobecnosci
                </th>
                <th className="text-right py-3 px-2 font-medium">Wskaznik</th>
                <th className="text-right py-3 px-2 font-medium">
                  Strata netto
                </th>
              </tr>
            </thead>
            <tbody>
              {reportData.byService.map((svc) => (
                <tr
                  key={svc.serviceId}
                  className="border-b hover:bg-muted/50"
                >
                  <td className="py-3 px-2 font-medium">{svc.serviceName}</td>
                  <td className="py-3 px-2 text-right">{svc.total}</td>
                  <td className="py-3 px-2 text-right">{svc.cancelled}</td>
                  <td className="py-3 px-2 text-right">{svc.noShow}</td>
                  <td className="py-3 px-2 text-right">
                    <Badge variant={getRateBadge(svc.rate)}>
                      <span className={getRateColor(svc.rate)}>
                        {svc.rate}%
                      </span>
                    </Badge>
                  </td>
                  <td className="py-3 px-2 text-right font-medium text-red-700">
                    {parseFloat(svc.netLostRevenue).toFixed(2)} PLN
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

"use client";

import { XCircle, UserX, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface ReasonTabProps {
  reportData: ReportData;
}

export function ReasonTab({ reportData }: ReasonTabProps) {
  if (reportData.summary.cancellationCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Podzial wg powodu
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <XCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak anulowanych wizyt w wybranym okresie</p>
            <p className="text-sm mt-1">To swietny wynik!</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Podzial wg powodu
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {reportData.byReason.map((item) => (
            <div
              key={item.reason}
              className="flex items-center gap-4 p-4 border rounded-lg"
            >
              <div className="shrink-0">
                {item.reason === "cancelled" ? (
                  <XCircle className="h-8 w-8 text-orange-500" />
                ) : (
                  <UserX className="h-8 w-8 text-red-500" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-medium text-lg">{item.reasonLabel}</div>
                <div className="text-sm text-muted-foreground">
                  {item.reason === "cancelled"
                    ? "Wizyty anulowane przez klienta lub personel"
                    : "Klient nie pojawil sie na wizycie"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{item.count}</div>
                <div className="text-sm text-muted-foreground">
                  {item.percentage}% anulacji
                </div>
              </div>
              <div className="w-32">
                <div className="w-full bg-muted rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${item.reason === "cancelled" ? "bg-orange-500" : "bg-red-500"}`}
                    style={{
                      width: `${Math.min(parseFloat(item.percentage), 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

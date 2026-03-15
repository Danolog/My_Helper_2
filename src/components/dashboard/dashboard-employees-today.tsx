"use client";

import { Users, Loader2, UserCheck, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatsProps } from "./dashboard-types";

export function DashboardEmployeesToday({ stats, statsLoading, statsError }: StatsProps) {
  return (
    <Card className="mb-6" data-testid="employees-today">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-primary" />
          Pracownicy dzisiaj
          {stats && (
            <Badge variant="secondary" className="text-xs">
              {stats.employeesToday.filter((e) => e.isWorkingToday).length} / {stats.employeesToday.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {statsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Ladowanie...</span>
          </div>
        ) : statsError ? (
          <p className="text-sm text-destructive py-4">{statsError}</p>
        ) : stats && stats.employeesToday.length === 0 ? (
          <div className="text-center py-6">
            <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Brak pracownikow w systemie
            </p>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.employeesToday.map((emp) => (
              <div
                key={emp.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  emp.isWorkingToday
                    ? "bg-green-50/50 border-green-200 dark:bg-green-950/10 dark:border-green-800"
                    : "bg-muted/30 border-border opacity-60"
                }`}
              >
                {/* Color dot */}
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: emp.color || "#3b82f6" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {emp.firstName} {emp.lastName}
                  </div>
                  {emp.isWorkingToday ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <UserCheck className="h-3 w-3 text-green-600" />
                      {emp.workStart} - {emp.workEnd}
                      {emp.appointmentCount > 0 && (
                        <span className="ml-1">({emp.appointmentCount} wizyt)</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <UserX className="h-3 w-3" />
                      Wolne
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

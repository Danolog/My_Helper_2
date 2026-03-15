"use client";

import Link from "next/link";
import { Calendar, Loader2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, STATUS_STYLES, STATUS_LABELS } from "./dashboard-types";
import type { StatsProps } from "./dashboard-types";

export function DashboardTodayAppointments({ stats, statsLoading, statsError }: StatsProps) {
  return (
    <Card className="mb-6" data-testid="today-appointments">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5 text-primary" />
            Dzisiejsze wizyty
            {stats && (
              <Badge variant="secondary" className="text-xs">
                {stats.todayAppointments.length}
              </Badge>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/calendar">
              Otworz kalendarz
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Ladowanie wizyt...</span>
          </div>
        ) : statsError ? (
          <p className="text-sm text-destructive py-4">{statsError}</p>
        ) : stats && stats.todayAppointments.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Brak zaplanowanych wizyt na dzisiaj
            </p>
          </div>
        ) : stats ? (
          <div className="space-y-2">
            {stats.todayAppointments.map((appt) => (
              <div
                key={appt.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
              >
                {/* Employee color indicator */}
                <div
                  className="w-1 h-10 rounded-full shrink-0"
                  style={{ backgroundColor: appt.employeeColor || "#3b82f6" }}
                />
                {/* Time */}
                <div className="shrink-0 text-center min-w-[60px]">
                  <div className="text-sm font-semibold">
                    {formatTime(appt.startTime)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {appt.serviceDuration} min
                  </div>
                </div>
                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {appt.clientName}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${STATUS_STYLES[appt.status] || ""}`}
                    >
                      {STATUS_LABELS[appt.status] || appt.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {appt.serviceName} - {appt.employeeName}
                  </div>
                </div>
                {/* Price */}
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold">
                    {appt.servicePrice.toFixed(0)} PLN
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

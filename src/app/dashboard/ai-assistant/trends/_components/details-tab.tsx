"use client";

import { Briefcase, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendIcon, TrendBadge } from "./trend-indicators";
import type { TrendsData } from "../_types";

interface DetailsTabProps {
  data: TrendsData;
}

/**
 * The "Szczegoly" tab — shows service popularity rankings,
 * employee performance by revenue, and weekly comparison summary.
 */
export function DetailsTab({ data }: DetailsTabProps) {
  return (
    <div className="space-y-6">
      {/* Service Popularity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Popularnosc uslug
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.servicePopularity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak danych o uslugach w tym okresie.</p>
          ) : (
            <div className="space-y-3">
              {data.servicePopularity.map((svc, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <TrendIcon trend={svc.trend} />
                    <div>
                      <p className="text-sm font-medium">{svc.serviceName}</p>
                      <p className="text-xs text-muted-foreground">
                        {svc.currentCount} wizyt (poprz.: {svc.previousCount})
                      </p>
                    </div>
                  </div>
                  <TrendBadge trend={svc.trend} percent={svc.changePercent} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employee Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-5 w-5" />
            Wyniki pracownikow (przychod)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.employeePerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak danych o pracownikach w tym okresie.</p>
          ) : (
            <div className="space-y-3">
              {data.employeePerformance.map((emp, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <TrendIcon trend={emp.trend} />
                    <div>
                      <p className="text-sm font-medium">{emp.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.currentRevenue.toFixed(2)} PLN (poprz.: {emp.previousRevenue.toFixed(2)} PLN)
                      </p>
                    </div>
                  </div>
                  <TrendBadge trend={emp.trend} percent={emp.changePercent} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly comparison summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Porownanie tygodniowe</CardTitle>
          <p className="text-xs text-muted-foreground">
            {data.period.currentWeek} vs {data.period.previousWeek}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Przychod</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{data.revenue.weeklyCurrentRevenue.toFixed(2)} PLN</span>
                  <TrendBadge trend={data.revenue.weeklyTrend} percent={data.revenue.weeklyChangePercent} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Wizyty</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{data.appointments.weeklyCurrentCount}</span>
                  <TrendBadge trend={data.appointments.weeklyTrend} percent={data.appointments.weeklyChangePercent} />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Poprz. tydzien przychod</span>
                <span>{data.revenue.weeklyPreviousRevenue.toFixed(2)} PLN</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Poprz. tydzien wizyty</span>
                <span>{data.appointments.weeklyPreviousCount}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { Trophy, Users, UserCheck, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRankIcon, getRankBadgeColor } from "../_types";
import type { EmployeePopularity } from "../_types";

interface PopularityChartProps {
  employees: EmployeePopularity[];
  maxBookings: number;
}

export function PopularityChart({ employees, maxBookings }: PopularityChartProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          Ranking wg liczby rezerwacji
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
            <p className="text-sm mt-1">
              Zmien zakres dat lub sprawdz czy istnieja rezerwacje
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {employees.map((emp) => (
              <div
                key={emp.employeeId}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  emp.rank <= 3
                    ? "bg-gradient-to-r from-muted/50 to-transparent"
                    : ""
                }`}
              >
                {/* Rank badge */}
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border ${getRankBadgeColor(emp.rank)}`}
                >
                  {getRankIcon(emp.rank)}
                </div>

                {/* Employee name and color */}
                <div className="flex items-center gap-2 w-40 shrink-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: emp.color || "#3b82f6" }}
                  />
                  <span className="font-medium text-sm truncate">
                    {emp.employeeName}
                  </span>
                </div>

                {/* Booking bar */}
                <div className="flex-1">
                  <div className="bg-muted rounded-full h-6 relative overflow-hidden">
                    <div
                      className="bg-blue-500 h-6 rounded-full flex items-center transition-all"
                      style={{
                        width: `${Math.max(
                          (emp.totalBookings / maxBookings) * 100,
                          3
                        )}%`,
                      }}
                    >
                      {emp.totalBookings / maxBookings > 0.2 && (
                        <span className="text-xs text-white font-medium pl-2 whitespace-nowrap">
                          {emp.totalBookings} rez.
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats badges */}
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-xs">
                    {emp.totalBookings} rez.
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    title="Retencja klientow"
                  >
                    <UserCheck className="h-3 w-3 mr-1" />
                    {emp.retentionRate}%
                  </Badge>
                  {emp.reviewCount > 0 && (
                    <Badge
                      variant="outline"
                      className="text-xs"
                      title="Srednia ocena"
                    >
                      <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
                      {emp.avgRating}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

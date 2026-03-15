"use client";

import {
  Loader2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  CalendarDays,
  Users,
  Star,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AnalyticsData } from "../_types";

interface AnalyticsSummaryProps {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function AnalyticsSummary({
  data,
  loading,
  error,
  onRefresh,
}: AnalyticsSummaryProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">
          Ladowanie danych salonu...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const growthPercent = data.appointments.growthPercent;
  const revenueGrowth = data.revenue.growthPercent;

  return (
    <div className="space-y-4">
      {/* Key metrics */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Przychod (30 dni)</span>
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">
              {data.revenue.last30Days.toFixed(0)} PLN
            </div>
            {revenueGrowth !== "N/A" && (
              <div className="flex items-center gap-1 mt-1">
                {Number(revenueGrowth) > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : Number(revenueGrowth) < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-yellow-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {Number(revenueGrowth) > 0 ? "+" : ""}
                  {revenueGrowth}% vs poprz.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Wizyty (30 dni)</span>
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">{data.appointments.last30Days}</div>
            {growthPercent !== "N/A" && (
              <div className="flex items-center gap-1 mt-1">
                {Number(growthPercent) > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : Number(growthPercent) < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-yellow-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {Number(growthPercent) > 0 ? "+" : ""}
                  {growthPercent}% vs poprz.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Klienci</span>
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">{data.overview.totalClients}</div>
            <div className="text-xs text-muted-foreground mt-1">
              +{data.overview.newClientsThisMonth} nowych w tym mies.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Srednia ocena</span>
              <Star className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">
              {data.reviews.averageRating}/5
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {data.reviews.totalReviews} opinii
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary info */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        {/* Top services */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Najpopularniejsze uslugi
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.topServices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-1.5">
                {data.topServices.slice(0, 3).map((svc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate">{svc.serviceName}</span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      {svc.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top employees */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Najaktywniejszi pracownicy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.topEmployees.length === 0 ? (
              <p className="text-xs text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-1.5">
                {data.topEmployees.slice(0, 3).map((emp, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate">
                      {emp.firstName} {emp.lastName}
                    </span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      {emp.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low stock alerts */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Package className="h-3 w-3" />
              Niski stan magazynowy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.inventory.lowStockCount === 0 ? (
              <p className="text-xs text-green-600">
                Wszystkie produkty w normie
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.inventory.lowStockProducts.slice(0, 3).map((p, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate text-red-600">{p.name}</span>
                    <span className="text-muted-foreground ml-2">
                      {p.quantity} {p.unit || "szt."}
                    </span>
                  </div>
                ))}
                {data.inventory.lowStockCount > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{data.inventory.lowStockCount - 3} wiecej
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { TrendingUp, Users, Heart, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface PopularityFiltersProps {
  reportData: ReportData;
}

export function PopularityFilters({ reportData }: PopularityFiltersProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Laczne rezerwacje
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            {reportData.summary.totalBookings}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Pracownikow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <Users className="h-5 w-5 text-purple-600" />
            {reportData.summary.totalEmployees}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Srednia retencja klientow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <Heart className="h-5 w-5 text-red-500" />
            {reportData.summary.avgRetentionRate}%
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Srednia ocena
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            {parseFloat(reportData.summary.avgRating).toFixed(1)} / 5
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import {
  Calendar,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface YearlyComparisonFiltersProps {
  year1: string;
  year2: string;
  onYear1Change: (value: string) => void;
  onYear2Change: (value: string) => void;
  onGenerate: () => void;
  loading: boolean;
}

export function YearlyComparisonFilters({
  year1,
  year2,
  onYear1Change,
  onYear2Change,
  onGenerate,
  loading,
}: YearlyComparisonFiltersProps) {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[150px]">
            <label className="text-sm font-medium mb-1 block">
              <Calendar className="h-3 w-3 inline mr-1" />
              Rok 1
            </label>
            <Input
              type="number"
              min="2000"
              max="2099"
              value={year1}
              onChange={(e) => onYear1Change(e.target.value)}
              placeholder="np. 2025"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="text-sm font-medium mb-1 block">
              <Calendar className="h-3 w-3 inline mr-1" />
              Rok 2
            </label>
            <Input
              type="number"
              min="2000"
              max="2099"
              value={year2}
              onChange={(e) => onYear2Change(e.target.value)}
              placeholder="np. 2026"
            />
          </div>
          <Button onClick={onGenerate} disabled={loading}>
            <Search className="h-4 w-4 mr-2" />
            {loading ? "Ladowanie..." : "Generuj porownanie"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

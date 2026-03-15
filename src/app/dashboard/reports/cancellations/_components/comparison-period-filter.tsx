"use client";

import { Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface ComparisonPeriodFilterProps {
  showComparison: boolean;
  onToggleComparison: () => void;
  compareDateFrom: string | undefined;
  onCompareDateFromChange: (value: string | undefined) => void;
  compareDateTo: string | undefined;
  onCompareDateToChange: (value: string | undefined) => void;
}

export function ComparisonPeriodFilter({
  showComparison,
  onToggleComparison,
  compareDateFrom,
  onCompareDateFromChange,
  compareDateTo,
  onCompareDateToChange,
}: ComparisonPeriodFilterProps) {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onToggleComparison}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              showComparison ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showComparison ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <label className="text-sm font-medium flex items-center gap-1">
            <Scale className="h-4 w-4" />
            Porownaj z innym okresem
          </label>
        </div>

        {showComparison && (
          <div className="flex flex-wrap items-end gap-4 ml-14">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block text-muted-foreground">
                Okres porownawczy od
              </label>
              <Input
                type="date"
                value={compareDateFrom}
                onChange={(e) => onCompareDateFromChange(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block text-muted-foreground">
                Okres porownawczy do
              </label>
              <Input
                type="date"
                value={compareDateTo}
                onChange={(e) => onCompareDateToChange(e.target.value)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

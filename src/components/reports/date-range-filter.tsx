"use client";

import { useState, useCallback, useEffect } from "react";
import { Calendar, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type QuickFilter =
  | "7days"
  | "30days"
  | "90days"
  | "thisWeek"
  | "thisMonth"
  | "thisYear"
  | "custom";

interface QuickFilterDef {
  key: QuickFilter;
  label: string;
  getRange: () => { from: string; to: string };
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Polish week starts on Monday (1), so adjust Sunday (0) to be 7
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

const QUICK_FILTERS: QuickFilterDef[] = [
  {
    key: "7days",
    label: "7 dni",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 7);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
  {
    key: "30days",
    label: "30 dni",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 30);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
  {
    key: "90days",
    label: "90 dni",
    getRange: () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 90);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
  {
    key: "thisWeek",
    label: "Ten tydzien",
    getRange: () => {
      const to = new Date();
      const from = getStartOfWeek(to);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
  {
    key: "thisMonth",
    label: "Ten miesiac",
    getRange: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), to.getMonth(), 1);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
  {
    key: "thisYear",
    label: "Ten rok",
    getRange: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), 0, 1);
      return { from: toDateString(from), to: toDateString(to) };
    },
  },
];

interface DateRangeFilterProps {
  dateFrom: string | undefined;
  dateTo: string | undefined;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onApply: () => void;
  loading?: boolean;
}

export function DateRangeFilter({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onApply,
  loading = false,
}: DateRangeFilterProps) {
  const [activeQuickFilter, setActiveQuickFilter] =
    useState<QuickFilter>("30days");

  // Detect which quick filter matches on mount and when dates change externally
  const detectActiveFilter = useCallback(() => {
    for (const filter of QUICK_FILTERS) {
      const range = filter.getRange();
      if (range.from === dateFrom && range.to === dateTo) {
        return filter.key;
      }
    }
    return "custom" as QuickFilter;
  }, [dateFrom, dateTo]);

  useEffect(() => {
    setActiveQuickFilter(detectActiveFilter());
  }, [detectActiveFilter]);

  const handleQuickFilter = (filter: QuickFilterDef) => {
    const range = filter.getRange();
    onDateFromChange(range.from);
    onDateToChange(range.to);
    setActiveQuickFilter(filter.key);
  };

  const handleManualDateChange = (
    field: "from" | "to",
    value: string
  ) => {
    if (field === "from") {
      onDateFromChange(value);
    } else {
      onDateToChange(value);
    }
    setActiveQuickFilter("custom");
  };

  // Format active range description
  const getActivePeriodLabel = (): string => {
    if (!dateFrom || !dateTo) return "";
    const from = new Date(dateFrom + "T12:00:00");
    const to = new Date(dateTo + "T12:00:00");
    const diffDays = Math.round(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    );
    const fromStr = from.toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const toStr = to.toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return `${fromStr} - ${toStr} (${diffDays} dni)`;
  };

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        {/* Quick filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-sm font-medium text-muted-foreground mr-1">
            Szybkie filtry:
          </span>
          {QUICK_FILTERS.map((filter) => (
            <Button
              key={filter.key}
              variant={
                activeQuickFilter === filter.key ? "default" : "outline"
              }
              size="sm"
              onClick={() => handleQuickFilter(filter)}
              className="h-8 text-xs"
            >
              {filter.label}
            </Button>
          ))}
          <Button
            variant={activeQuickFilter === "custom" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveQuickFilter("custom")}
            className="h-8 text-xs"
          >
            Wlasny zakres
          </Button>
        </div>

        {/* Custom date range inputs */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-1 block">
              <Calendar className="h-3 w-3 inline mr-1" />
              Data od
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) =>
                handleManualDateChange("from", e.target.value)
              }
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-1 block">
              <Calendar className="h-3 w-3 inline mr-1" />
              Data do
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) =>
                handleManualDateChange("to", e.target.value)
              }
            />
          </div>
          <Button onClick={onApply} disabled={loading}>
            <Search className="h-4 w-4 mr-2" />
            {loading ? "Ladowanie..." : "Generuj raport"}
          </Button>
        </div>

        {/* Active period badge */}
        {dateFrom && dateTo && (
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              <Calendar className="h-3 w-3 mr-1" />
              {getActivePeriodLabel()}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

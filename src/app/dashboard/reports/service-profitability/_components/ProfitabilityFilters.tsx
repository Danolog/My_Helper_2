"use client";

import {
  Scissors,
  PieChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProfitabilityFiltersProps {
  activeTab: "summary" | "details";
  onTabChange: (tab: "summary" | "details") => void;
}

export function ProfitabilityFilters({
  activeTab,
  onTabChange,
}: ProfitabilityFiltersProps) {
  return (
    <div className="flex gap-2 mb-4">
      <Button
        variant={activeTab === "summary" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("summary")}
      >
        <Scissors className="h-4 w-4 mr-1" />
        Podsumowanie
      </Button>
      <Button
        variant={activeTab === "details" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("details")}
      >
        <PieChart className="h-4 w-4 mr-1" />
        Szczegoly kosztow
      </Button>
    </div>
  );
}

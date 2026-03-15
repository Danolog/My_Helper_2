"use client";

import { Button } from "@/components/ui/button";
import type { ActiveTab } from "../_types";

interface TabNavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex gap-2 mb-4">
      <Button
        variant={activeTab === "summary" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("summary")}
      >
        Zysk/Strata wg produktu
      </Button>
      <Button
        variant={activeTab === "details" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("details")}
      >
        Szczegolowe zuzycie
      </Button>
    </div>
  );
}

"use client";

import {
  DollarSign,
  AlertTriangle,
  Users,
  Scissors,
  Calendar,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActiveTab } from "../_types";

interface TabNavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

const TABS: { key: ActiveTab; label: string; icon: React.ElementType }[] = [
  { key: "lostrevenue", label: "Utracony przychod", icon: DollarSign },
  { key: "reason", label: "Wg powodu", icon: AlertTriangle },
  { key: "employee", label: "Wg pracownika", icon: Users },
  { key: "service", label: "Wg uslugi", icon: Scissors },
  { key: "dayofweek", label: "Wg dnia tygodnia", icon: Calendar },
  { key: "trend", label: "Trend dzienny", icon: TrendingDown },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {TABS.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          variant={activeTab === key ? "default" : "outline"}
          size="sm"
          onClick={() => onTabChange(key)}
        >
          <Icon className="h-4 w-4 mr-1" />
          {label}
        </Button>
      ))}
    </div>
  );
}

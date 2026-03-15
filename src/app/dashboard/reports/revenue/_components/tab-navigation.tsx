"use client";

import { Scissors, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RevenueActiveTab } from "../_types";

interface TabNavigationProps {
  activeTab: RevenueActiveTab;
  onTabChange: (tab: RevenueActiveTab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex gap-2 mb-4">
      <Button
        variant={activeTab === "service" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("service")}
      >
        <Scissors className="h-4 w-4 mr-1" />
        Wg uslugi
      </Button>
      <Button
        variant={activeTab === "employee" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("employee")}
      >
        <Users className="h-4 w-4 mr-1" />
        Wg pracownika
      </Button>
      <Button
        variant={activeTab === "trend" ? "default" : "outline"}
        size="sm"
        onClick={() => onTabChange("trend")}
      >
        <TrendingUp className="h-4 w-4 mr-1" />
        Trend dzienny
      </Button>
    </div>
  );
}

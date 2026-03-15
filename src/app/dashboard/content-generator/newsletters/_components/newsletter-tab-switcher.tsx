"use client";

import { Sparkles, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type NewsletterTabSwitcherProps = {
  activeTab: "create" | "saved";
  savedCount: number;
  onTabChange: (tab: "create" | "saved") => void;
};

export function NewsletterTabSwitcher({
  activeTab,
  savedCount,
  onTabChange,
}: NewsletterTabSwitcherProps) {
  return (
    <div className="flex gap-2 mb-6">
      <Button
        variant={activeTab === "create" ? "default" : "outline"}
        onClick={() => onTabChange("create")}
        className="flex items-center gap-2"
      >
        <Sparkles className="h-4 w-4" />
        Generuj nowy
      </Button>
      <Button
        variant={activeTab === "saved" ? "default" : "outline"}
        onClick={() => onTabChange("saved")}
        className="flex items-center gap-2"
      >
        <FileText className="h-4 w-4" />
        Zapisane ({savedCount})
      </Button>
    </div>
  );
}

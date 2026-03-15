"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InsightCard } from "./trend-indicators";
import type { Insight } from "../_types";

interface InsightsTabProps {
  insights: Insight[];
}

/**
 * The "Wnioski AI" tab — displays AI-generated insights and
 * recommendations grouped by positive/negative/info types.
 */
export function InsightsTab({ insights }: InsightsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Wnioski i rekomendacje AI</h2>
        <Badge variant="secondary">{insights.length}</Badge>
      </div>

      {insights.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Brak wnioskow do wyswietlenia. Dodaj wiecej danych do systemu.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight, idx) => (
            <InsightCard key={idx} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}

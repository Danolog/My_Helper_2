"use client";

import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
} from "lucide-react";
import type { TrendDirection, Insight } from "../_types";

// ────────────────────────────────────────────────────────────
// TrendIcon — directional arrow for trend visualization
// ────────────────────────────────────────────────────────────

export function TrendIcon({ trend, size = 16 }: { trend: TrendDirection; size?: number }) {
  if (trend === "up") return <TrendingUp className="text-green-600" style={{ width: size, height: size }} />;
  if (trend === "down") return <TrendingDown className="text-red-500" style={{ width: size, height: size }} />;
  return <Minus className="text-yellow-500" style={{ width: size, height: size }} />;
}

// ────────────────────────────────────────────────────────────
// TrendBadge — colored pill showing trend direction + percent
// ────────────────────────────────────────────────────────────

export function TrendBadge({ trend, percent }: { trend: TrendDirection; percent: number }) {
  const colors =
    trend === "up"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : trend === "down"
      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";

  const icon =
    trend === "up" ? (
      <ArrowUpRight className="h-3 w-3" />
    ) : trend === "down" ? (
      <ArrowDownRight className="h-3 w-3" />
    ) : (
      <Minus className="h-3 w-3" />
    );

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {icon}
      {trend === "stable" ? "Stabilny" : `${percent > 0 ? "+" : ""}${percent}%`}
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// InsightCard — colored card for a single AI insight
// ────────────────────────────────────────────────────────────

export function InsightCard({ insight }: { insight: Insight }) {
  const colors =
    insight.type === "positive"
      ? "border-l-green-500 bg-green-50 dark:bg-green-900/10"
      : insight.type === "negative"
      ? "border-l-red-500 bg-red-50 dark:bg-red-900/10"
      : "border-l-blue-500 bg-blue-50 dark:bg-blue-900/10";

  const icon =
    insight.type === "positive" ? (
      <TrendingUp className="h-4 w-4 text-green-600" />
    ) : insight.type === "negative" ? (
      <TrendingDown className="h-4 w-4 text-red-500" />
    ) : (
      <Sparkles className="h-4 w-4 text-blue-500" />
    );

  return (
    <div className={`border-l-4 rounded-r-lg p-3 ${colors}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <p className="text-sm">{insight.message}</p>
      </div>
    </div>
  );
}

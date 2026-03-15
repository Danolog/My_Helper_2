"use client";

import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

interface DeltaIndicatorProps {
  value: number;
  /** When true, positive delta is good (green) instead of bad (red) */
  invertColors?: boolean;
}

/**
 * Renders an up/down/neutral arrow with color-coded text
 * to indicate the direction and sentiment of a metric change.
 */
export function DeltaIndicator({
  value,
  invertColors = false,
}: DeltaIndicatorProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  // For revenue loss, positive delta = worse (red), negative delta = better (green)
  // invertColors flips this for metrics where higher is better
  const goodColor = invertColors ? "text-red-600" : "text-green-600";
  const badColor = invertColors ? "text-green-600" : "text-red-600";

  if (isPositive) {
    return (
      <span
        className={`flex items-center gap-0.5 text-sm font-medium ${badColor}`}
      >
        <ArrowUpRight className="h-3.5 w-3.5" />+
        {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
      </span>
    );
  }
  if (isNegative) {
    return (
      <span
        className={`flex items-center gap-0.5 text-sm font-medium ${goodColor}`}
      >
        <ArrowDownRight className="h-3.5 w-3.5" />
        {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-sm font-medium text-muted-foreground">
      <Minus className="h-3.5 w-3.5" />0
    </span>
  );
}

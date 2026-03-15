"use client";

import { AlertTriangle } from "lucide-react";
import type { Product } from "../_types";

interface LowStockWarningProps {
  lowStockProducts: Product[];
}

export function LowStockWarning({ lowStockProducts }: LowStockWarningProps) {
  if (lowStockProducts.length === 0) return null;

  return (
    <div
      className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
      data-testid="low-stock-warning"
    >
      <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-orange-800 dark:text-orange-300">
          Niski stan magazynowy ({lowStockProducts.length})
        </p>
        <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
          {lowStockProducts.map((p) => p.name).join(", ")}
        </p>
      </div>
    </div>
  );
}

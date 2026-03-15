"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isExpired } from "../_types";
import type { PromoCode } from "../_types";

interface PromoCodesFiltersProps {
  codesList: PromoCode[];
}

export function PromoCodesFilters({ codesList }: PromoCodesFiltersProps) {
  const activeCodes = codesList.filter(
    (c) => !isExpired(c.expiresAt) && (c.usageLimit == null || (c.usedCount ?? 0) < c.usageLimit)
  );
  const expiredOrUsedCodes = codesList.filter(
    (c) => isExpired(c.expiresAt) || (c.usageLimit != null && (c.usedCount ?? 0) >= c.usageLimit)
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Wszystkie kody
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{codesList.length}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Aktywne
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {activeCodes.length}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Wygasle / Wykorzystane
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-gray-400">
            {expiredOrUsedCodes.length}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

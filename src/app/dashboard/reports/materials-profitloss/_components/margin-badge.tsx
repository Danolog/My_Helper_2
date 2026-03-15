"use client";

import { Badge } from "@/components/ui/badge";

interface MarginBadgeProps {
  margin: number;
}

/** Renders a colored Badge based on the profit margin level */
export function MarginBadge({ margin }: MarginBadgeProps) {
  if (margin >= 70)
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
        Wysoki zysk
      </Badge>
    );
  if (margin >= 50)
    return (
      <Badge className="bg-green-50 text-green-700 hover:bg-green-50">
        Dobry zysk
      </Badge>
    );
  if (margin >= 30)
    return (
      <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
        Sredni zysk
      </Badge>
    );
  if (margin >= 0)
    return (
      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
        Niski zysk
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Strata</Badge>
  );
}

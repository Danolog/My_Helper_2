"use client";

import { Badge } from "@/components/ui/badge";
import { STATUS_CONFIG, isKnownStatus } from "../_types";

interface StatusBadgeProps {
  status: string;
}

/** Renders a colored badge with icon for the given appointment status. */
export function StatusBadge({ status }: StatusBadgeProps) {
  if (!isKnownStatus(status)) {
    return <Badge variant="outline">{status}</Badge>;
  }

  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge className={config.className}>
      <Icon className="w-3 h-3 mr-1" />
      {config.label}
    </Badge>
  );
}

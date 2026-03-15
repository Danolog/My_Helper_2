"use client";

import {
  AlertTriangle,
  Clock,
  Phone,
  PhoneOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CallLogEntry } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CallLogListProps {
  entries: CallLogEntry[];
}

// ---------------------------------------------------------------------------
// Component — renders individual call log entries
// ---------------------------------------------------------------------------

export function CallLogList({ entries }: CallLogListProps) {
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="p-3 border rounded-lg space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {entry.callerPhone}
              </span>
              <Badge variant="outline" className="text-xs">
                {entry.intent}
              </Badge>
              {entry.intent === "escalate_to_human" && (
                <Badge
                  variant="destructive"
                  className="gap-1 text-xs"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Eskalacja
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(entry.timestamp).toLocaleString("pl-PL")}
            </span>
          </div>
          <div className="text-sm">
            <span className="font-medium text-muted-foreground">
              Klient:
            </span>{" "}
            {entry.callerMessage}
          </div>
          <div className="text-sm">
            <span className="font-medium text-primary">AI:</span>{" "}
            {entry.aiResponse}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state component used when there are no entries
// ---------------------------------------------------------------------------

export function CallLogEmpty() {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <PhoneOff className="h-12 w-12 mx-auto mb-3 opacity-40" />
      <p>Brak historii polaczen</p>
      <p className="text-sm">
        Przetestuj asystenta w zakladce &quot;Symulacja polaczenia&quot;
      </p>
    </div>
  );
}

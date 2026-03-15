"use client";

import {
  History,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CallLogEntry } from "./types";
import { CallLogList, CallLogEmpty } from "./call-log-list";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceCommandHistoryProps {
  callLog: CallLogEntry[];
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Component — the call log tab content
// ---------------------------------------------------------------------------

export function VoiceCommandHistory({
  callLog,
  loading,
}: VoiceCommandHistoryProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historia polaczen AI
          </CardTitle>
          <CardDescription>
            Ostatnie polaczenia obsluzone przez asystenta glosowego
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : callLog.length === 0 ? (
            <CallLogEmpty />
          ) : (
            <CallLogList entries={callLog} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

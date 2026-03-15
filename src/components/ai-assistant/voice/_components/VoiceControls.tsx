"use client";

// ---------------------------------------------------------------------------
// VoiceControls — call simulation input card with textarea, send button,
// and quick-test message buttons.
// ---------------------------------------------------------------------------

import {
  Loader2,
  PhoneIncoming,
  Send,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceAiConfig } from "../types";

// ---------------------------------------------------------------------------
// Quick-test messages shown as shortcut buttons
// ---------------------------------------------------------------------------

const QUICK_TEST_MESSAGES = [
  "Chce umowic wizyte na strzyzenie",
  "Jakie macie ceny?",
  "Czy jest wolny termin w piatek?",
  "Czy Anna Kowalska jest dostepna jutro o 10?",
  "Chce umowic wizyte u Anna jutro o 15:00 na strzyzenie",
  "Chce odwolac wizyte",
  "Chce zmienic termin wizyty",
  "Polacz mnie z recepcja",
  "Mam reklamacje dotyczaca ostatniej wizyty",
  "Mialem reakcje alergiczna po zabiegu",
  "Chce zlozyc skarge na pracownika",
  "Potrzebuje fakture i chce zmienic termin i ile kosztuje manicure",
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceControlsProps {
  config: VoiceAiConfig;
  callerMessage: string;
  setCallerMessage: (value: string) => void;
  simulating: boolean;
  onSimulateCall: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceControls({
  config,
  callerMessage,
  setCallerMessage,
  simulating,
  onSimulateCall,
}: VoiceControlsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneIncoming className="h-5 w-5 text-green-600" />
          Symulacja polaczenia przychodzacego
        </CardTitle>
        <CardDescription>
          Przetestuj jak AI odpowiada na rozne zapytania klientow
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!config.enabled && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
            <XCircle className="h-4 w-4 shrink-0" />
            Asystent glosowy jest wylaczony. Wlacz go w zakladce
            Konfiguracja, aby testowac polaczenia.
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="caller-message">
            Wiadomosc dzwoniacego klienta
          </Label>
          <div className="flex gap-2">
            <Textarea
              id="caller-message"
              value={callerMessage}
              onChange={(e) => setCallerMessage(e.target.value)}
              placeholder="Np. Chcialbym umowic sie na strzyzenie na piatek..."
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSimulateCall();
                }
              }}
            />
            <Button
              onClick={onSimulateCall}
              disabled={simulating || !callerMessage.trim()}
              className="shrink-0"
              size="lg"
            >
              {simulating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Quick Test Messages */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Szybkie testy:
          </Label>
          <div className="flex flex-wrap gap-2">
            {QUICK_TEST_MESSAGES.map((msg) => (
              <Button
                key={msg}
                variant="outline"
                size="sm"
                onClick={() => setCallerMessage(msg)}
                className="text-xs"
              >
                {msg}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

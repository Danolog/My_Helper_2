"use client";

// ---------------------------------------------------------------------------
// VoiceMessageForm — escalation message form shown when the AI detects
// that a call needs human intervention but transfer is not available.
// The caller can leave a message with their contact details.
// ---------------------------------------------------------------------------

import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MessageResult } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceMessageFormProps {
  msgName: string;
  setMsgName: (value: string) => void;
  msgPhone: string;
  setMsgPhone: (value: string) => void;
  msgText: string;
  setMsgText: (value: string) => void;
  sendingMessage: boolean;
  messageResult: MessageResult | null;
  onSendMessage: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceMessageForm({
  msgName,
  setMsgName,
  msgPhone,
  setMsgPhone,
  msgText,
  setMsgText,
  sendingMessage,
  messageResult,
  onSendMessage,
}: VoiceMessageFormProps) {
  return (
    <div className="p-4 border border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <p className="font-semibold text-amber-800 dark:text-amber-200 text-sm">
          Zostaw wiadomosc
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Przekierowanie do recepcji jest niedostepne. Zostaw wiadomosc, a skontaktujemy sie z Toba.
      </p>

      {messageResult ? (
        <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-800 dark:text-green-200 text-sm">
              Wiadomosc zapisana
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Numer referencyjny:{" "}
              <code className="bg-green-100 dark:bg-green-900 px-1 py-0.5 rounded font-mono">
                {messageResult.referenceNumber}
              </code>
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="msg-name" className="text-xs">
                Imie i nazwisko
              </Label>
              <Input
                id="msg-name"
                value={msgName}
                onChange={(e) => setMsgName(e.target.value)}
                placeholder="Jan Kowalski"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="msg-phone" className="text-xs">
                Telefon *
              </Label>
              <Input
                id="msg-phone"
                value={msgPhone}
                onChange={(e) => setMsgPhone(e.target.value)}
                placeholder="+48 123 456 789"
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="msg-text" className="text-xs">
              Tresc wiadomosci *
            </Label>
            <Textarea
              id="msg-text"
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Opisz swoja sprawe..."
              rows={3}
            />
          </div>
          <Button
            onClick={onSendMessage}
            disabled={sendingMessage || !msgText.trim() || !msgPhone.trim()}
            className="w-full gap-2"
            size="sm"
          >
            {sendingMessage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Wyslij wiadomosc
          </Button>
        </div>
      )}
    </div>
  );
}

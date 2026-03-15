"use client";

// ---------------------------------------------------------------------------
// VoiceCallSimulator — combines the call simulation input (VoiceControls)
// with the AI response result display, escalation alerts, availability data,
// and inline message form (VoiceMessageForm).
// ---------------------------------------------------------------------------

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquare,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Volume2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CallSimulationResult,
  MessageResult,
  VoiceAiConfig,
} from "../types";
import { VoiceControls } from "./VoiceControls";
import { VoiceMessageForm } from "./VoiceMessageForm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceCallSimulatorProps {
  config: VoiceAiConfig;
  callerMessage: string;
  setCallerMessage: (value: string) => void;
  simulating: boolean;
  onSimulateCall: () => Promise<void>;
  callResult: CallSimulationResult | null;
  // Escalation / leave-message props
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

export function VoiceCallSimulator({
  config,
  callerMessage,
  setCallerMessage,
  simulating,
  onSimulateCall,
  callResult,
  msgName,
  setMsgName,
  msgPhone,
  setMsgPhone,
  msgText,
  setMsgText,
  sendingMessage,
  messageResult,
  onSendMessage,
}: VoiceCallSimulatorProps) {
  return (
    <>
      {/* Call Simulation Input */}
      <VoiceControls
        config={config}
        callerMessage={callerMessage}
        setCallerMessage={setCallerMessage}
        simulating={simulating}
        onSimulateCall={onSimulateCall}
      />

      {/* Call Result */}
      {callResult && (
        <Card className="border-green-200 dark:border-green-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Odpowiedz asystenta AI
            </CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="secondary">
                <MessageSquare className="h-3 w-3 mr-1" />
                {callResult.intentLabel}
              </Badge>
              <Badge variant="outline">
                <Volume2 className="h-3 w-3 mr-1" />
                {callResult.voiceStyle === "professional"
                  ? "Profesjonalny"
                  : callResult.voiceStyle === "friendly"
                    ? "Przyjazny"
                    : "Ciepaly"}
              </Badge>
              {callResult.transferToHuman && (
                <Badge variant="destructive" className="gap-1">
                  <PhoneOff className="h-3 w-3" />
                  Przekierowanie do czlowieka
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI Greeting */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1 font-medium">
                Powitanie AI:
              </p>
              <p className="text-sm italic">{callResult.greeting}</p>
            </div>

            {/* AI Response */}
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-xs text-primary mb-1 font-medium">
                Odpowiedz AI:
              </p>
              <p className="text-sm leading-relaxed">{callResult.response}</p>
            </div>

            {callResult.suggestedAction && (
              <div className="text-xs text-muted-foreground">
                Sugerowana akcja systemu:{" "}
                <code className="bg-muted px-1 py-0.5 rounded">
                  {callResult.suggestedAction}
                </code>
              </div>
            )}

            {/* Escalation Display */}
            {callResult.intent === "escalate_to_human" && (
              <div className="space-y-4">
                {/* Escalation reason alert */}
                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-800 dark:text-amber-200 text-sm">
                      AI wykryl potrzebe eskalacji
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      Powod:{" "}
                      {callResult.escalationReason ||
                        "Zapytanie wymaga interwencji czlowieka"}
                    </p>
                  </div>
                </div>

                {/* Transfer animation or message form */}
                {callResult.transferToHuman ? (
                  <div className="p-4 border border-green-300 dark:border-green-700 rounded-lg bg-green-50 dark:bg-green-950/20 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <PhoneForwarded className="h-6 w-6 text-green-600 dark:text-green-400 animate-pulse" />
                      </div>
                      <div>
                        <p className="font-semibold text-green-800 dark:text-green-200">
                          Przekierowywanie do recepcji...
                        </p>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          Polaczenie jest przekazywane do pracownika salonu
                        </p>
                      </div>
                    </div>
                    {config.transferPhoneNumber && (
                      <Badge
                        variant="outline"
                        className="gap-1 text-green-700 dark:text-green-300 border-green-400"
                      >
                        <Phone className="h-3 w-3" />
                        {config.transferPhoneNumber}
                      </Badge>
                    )}
                    {/* Simulated transfer progress */}
                    <div className="space-y-1">
                      <div className="h-2 bg-green-200 dark:bg-green-800 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full animate-[pulse_2s_ease-in-out_infinite] w-3/4" />
                      </div>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Lacze z recepcja...
                      </p>
                    </div>
                  </div>
                ) : (
                  <VoiceMessageForm
                    msgName={msgName}
                    setMsgName={setMsgName}
                    msgPhone={msgPhone}
                    setMsgPhone={setMsgPhone}
                    msgText={msgText}
                    setMsgText={setMsgText}
                    sendingMessage={sendingMessage}
                    messageResult={messageResult}
                    onSendMessage={onSendMessage}
                  />
                )}
              </div>
            )}

            {/* Availability Data Display */}
            {callResult.availabilityData && (
              <AvailabilityDisplay
                availabilityData={callResult.availabilityData}
              />
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AvailabilityDisplay — private sub-component for calendar availability data
// ---------------------------------------------------------------------------

function AvailabilityDisplay({
  availabilityData,
}: {
  availabilityData: NonNullable<CallSimulationResult["availabilityData"]>;
}) {
  return (
    <div className="p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 space-y-3">
      <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Dane z kalendarza (sprawdzenie dostepnosci)
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Data:</span>{" "}
          <span className="font-medium">
            {availabilityData.dateFormatted} ({availabilityData.date})
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Pracownik:</span>{" "}
          <span className="font-medium">{availabilityData.employeeName}</span>
        </div>
        {availabilityData.serviceName && (
          <div>
            <span className="text-muted-foreground">Usluga:</span>{" "}
            <span className="font-medium">{availabilityData.serviceName}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Czas trwania:</span>{" "}
          <span className="font-medium">{availabilityData.duration} min</span>
        </div>
      </div>

      {availabilityData.dayOff ? (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <XCircle className="h-3 w-3" />
          Pracownik nie pracuje w tym dniu
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            Godziny pracy: {availabilityData.workStart} -{" "}
            {availabilityData.workEnd}
          </div>

          {availabilityData.requestedTime && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Zapytany termin: {availabilityData.requestedTime}
              </span>
              {availabilityData.requestedTimeAvailable === true && (
                <Badge
                  variant="default"
                  className="bg-green-600 gap-1 text-xs"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Dostepny
                </Badge>
              )}
              {availabilityData.requestedTimeAvailable === false && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <XCircle className="h-3 w-3" />
                  Zajety
                </Badge>
              )}
            </div>
          )}

          {availabilityData.alternativeTimes.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">
                Alternatywne terminy:{" "}
              </span>
              <span className="font-medium">
                {availabilityData.alternativeTimes.join(", ")}
              </span>
            </div>
          )}

          {/* Slots grid */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Dostepne terminy (
              {
                availabilityData.availableSlots.filter((s) => s.available)
                  .length
              }{" "}
              wolnych / {availabilityData.availableSlots.length} wszystkich):
            </p>
            <div className="flex flex-wrap gap-1">
              {availabilityData.availableSlots.map((slot) => (
                <span
                  key={slot.time}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    slot.available
                      ? slot.time === availabilityData.requestedTime
                        ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 ring-1 ring-green-400"
                        : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                      : slot.time === availabilityData.requestedTime
                        ? "bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 ring-1 ring-red-400"
                        : "bg-red-100/50 dark:bg-red-900/20 text-red-400 dark:text-red-500 line-through"
                  }`}
                >
                  {slot.time}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

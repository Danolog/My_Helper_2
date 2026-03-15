"use client";

// ---------------------------------------------------------------------------
// VoiceCancelForm — cancellation form card for cancelling appointments via
// the voice AI assistant. Shows phone input, optional appointment ID,
// deposit policy info, and a detailed result with refund status.
// ---------------------------------------------------------------------------

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Shield,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CancelResult } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceCancelFormProps {
  cancelPhone: string;
  setCancelPhone: (value: string) => void;
  cancelAppointmentId: string;
  setCancelAppointmentId: (value: string) => void;
  cancelInProgress: boolean;
  cancelResult: CancelResult | null;
  showCancelForm: boolean;
  setShowCancelForm: (value: boolean) => void;
  setCancelResult: (value: CancelResult | null) => void;
  onCancel: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceCancelForm({
  cancelPhone,
  setCancelPhone,
  cancelAppointmentId,
  setCancelAppointmentId,
  cancelInProgress,
  cancelResult,
  showCancelForm,
  setShowCancelForm,
  setCancelResult,
  onCancel,
}: VoiceCancelFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneOff className="h-5 w-5 text-red-600" />
          Anulacja wizyty przez telefon
        </CardTitle>
        <CardDescription>
          Symuluj proces odwolania wizyty przez asystenta glosowego
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showCancelForm && !cancelResult && (
          <Button
            onClick={() => {
              setShowCancelForm(true);
              setCancelResult(null);
            }}
            variant="outline"
            className="w-full gap-2"
          >
            <PhoneOff className="h-4 w-4" />
            Rozpocznij anulacje wizyty
          </Button>
        )}

        {showCancelForm && !cancelResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-200">
              <PhoneIncoming className="h-4 w-4 shrink-0" />
              Klient dzwoni i chce odwolac wizyte. Podaj numer telefonu, a
              system znajdzie najblizszа wizyte.
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancel-phone">
                <Phone className="inline h-3 w-3 mr-1" />
                Numer telefonu klienta *
              </Label>
              <Input
                id="cancel-phone"
                value={cancelPhone}
                onChange={(e) => setCancelPhone(e.target.value)}
                placeholder="+48 123 456 789"
              />
              <p className="text-xs text-muted-foreground">
                System znajdzie najblizszа wizyte klienta po numerze telefonu
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancel-appt-id">
                ID wizyty (opcjonalnie)
              </Label>
              <Input
                id="cancel-appt-id"
                value={cancelAppointmentId}
                onChange={(e) => setCancelAppointmentId(e.target.value)}
                placeholder="np. abc-123-def..."
              />
              <p className="text-xs text-muted-foreground">
                Zostaw puste - system automatycznie znajdzie najblizszа wizyte
              </p>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Polityka zadatku</p>
                <p>
                  Anulacja wiecej niz 24h przed wizyta: zadatek zwracany.
                  Anulacja mniej niz 24h przed wizyta: zadatek zatrzymany przez
                  salon.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelForm(false);
                  setCancelResult(null);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={onCancel}
                disabled={cancelInProgress || !cancelPhone.trim()}
                className="gap-2"
                variant="destructive"
              >
                {cancelInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOff className="h-4 w-4" />
                )}
                Odwolaj wizyte
              </Button>
            </div>
          </div>
        )}

        {cancelResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Wizyta anulowana pomyslnie!
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Asystent AI dokonal anulacji wizyty przez telefon
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg">
              <div>
                <span className="text-xs text-muted-foreground">Usluga:</span>
                <p className="font-medium">{cancelResult.details.serviceName}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Pracownik:</span>
                <p className="font-medium">{cancelResult.details.employeeName}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Data:</span>
                <p className="font-medium">{cancelResult.details.date}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Godzina:</span>
                <p className="font-medium">{cancelResult.details.time}</p>
              </div>
              {cancelResult.details.clientName && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground">Klient:</span>
                  <p className="font-medium">{cancelResult.details.clientName}</p>
                </div>
              )}
            </div>

            <div
              className={`p-4 border rounded-lg space-y-2 ${
                cancelResult.depositInfo.depositPolicy === "refund"
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  : cancelResult.depositInfo.depositPolicy === "forfeit"
                    ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                    : "bg-muted/30"
              }`}
            >
              <p className="text-xs font-semibold flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Informacja o zadatku
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Zadatek wplacony:</span>{" "}
                  <span className="font-medium">
                    {cancelResult.depositInfo.hasDeposit &&
                    cancelResult.depositInfo.depositPaid
                      ? `${cancelResult.depositInfo.depositAmount.toFixed(2)} PLN`
                      : "Nie"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Godzin do wizyty:</span>{" "}
                  <span className="font-medium">
                    {cancelResult.depositInfo.hoursUntilAppointment.toFixed(1)}h
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Polityka:</span>{" "}
                  {cancelResult.depositInfo.depositPolicy === "refund" && (
                    <Badge variant="default" className="bg-green-600 text-xs gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Zwrot zadatku ({cancelResult.depositInfo.depositAmount.toFixed(2)} PLN)
                    </Badge>
                  )}
                  {cancelResult.depositInfo.depositPolicy === "forfeit" && (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <XCircle className="h-3 w-3" />
                      Zadatek zatrzymany ({cancelResult.depositInfo.depositAmount.toFixed(2)} PLN)
                    </Badge>
                  )}
                  {cancelResult.depositInfo.depositPolicy === "none" && (
                    <Badge variant="secondary" className="text-xs">
                      Brak zadatku
                    </Badge>
                  )}
                </div>
              </div>
              {cancelResult.depositInfo.depositRefunded &&
                cancelResult.depositInfo.refund && (
                  <div className="flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Zwrot przetworzony: {cancelResult.depositInfo.refund.message}
                  </div>
                )}
            </div>

            <div className="flex items-center gap-2 p-3 border rounded-lg">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                SMS z potwierdzeniem anulacji:{" "}
                {cancelResult.smsConfirmation.sent ? (
                  <Badge variant="default" className="bg-green-600 text-xs">
                    Wyslany na {cancelResult.smsConfirmation.phone}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs">
                    Nie udalo sie wyslac
                  </Badge>
                )}
              </span>
            </div>

            <div className="text-xs text-muted-foreground">
              ID wizyty:{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                {cancelResult.details.appointmentId}
              </code>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setShowCancelForm(false);
                setCancelResult(null);
                setCancelAppointmentId("");
              }}
              className="w-full gap-2"
            >
              <PhoneOff className="h-4 w-4" />
              Nowa anulacja
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

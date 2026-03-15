"use client";

// ---------------------------------------------------------------------------
// VoiceRescheduleForm — reschedule form card for changing appointment dates
// via the voice AI assistant. Shows phone input, optional appointment ID,
// new date/time pickers, and a success result after rescheduling.
// ---------------------------------------------------------------------------

import {
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  PhoneIncoming,
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
import type { RescheduleResult } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceRescheduleFormProps {
  reschedulePhone: string;
  setReschedulePhone: (value: string) => void;
  rescheduleDate: string;
  setRescheduleDate: (value: string) => void;
  rescheduleTime: string;
  setRescheduleTime: (value: string) => void;
  rescheduleAppointmentId: string;
  setRescheduleAppointmentId: (value: string) => void;
  rescheduleInProgress: boolean;
  rescheduleResult: RescheduleResult | null;
  showRescheduleForm: boolean;
  setShowRescheduleForm: (value: boolean) => void;
  setRescheduleResult: (value: RescheduleResult | null) => void;
  onReschedule: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceRescheduleForm({
  reschedulePhone,
  setReschedulePhone,
  rescheduleDate,
  setRescheduleDate,
  rescheduleTime,
  setRescheduleTime,
  rescheduleAppointmentId,
  setRescheduleAppointmentId,
  rescheduleInProgress,
  rescheduleResult,
  showRescheduleForm,
  setShowRescheduleForm,
  setRescheduleResult,
  onReschedule,
}: VoiceRescheduleFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-orange-600" />
          Zmiana terminu przez telefon
        </CardTitle>
        <CardDescription>
          Symuluj proces zmiany terminu wizyty przez asystenta glosowego
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!showRescheduleForm && !rescheduleResult && (
          <Button
            onClick={() => {
              setShowRescheduleForm(true);
              setRescheduleResult(null);
            }}
            variant="outline"
            className="w-full gap-2"
          >
            <Calendar className="h-4 w-4" />
            Rozpocznij zmiane terminu
          </Button>
        )}

        {showRescheduleForm && !rescheduleResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg text-sm text-orange-800 dark:text-orange-200">
              <PhoneIncoming className="h-4 w-4 shrink-0" />
              Klient dzwoni i chce zmienic termin wizyty. Podaj numer telefonu i
              nowy preferowany termin.
            </div>

            <div className="space-y-2">
              <Label htmlFor="reschedule-phone">
                <Phone className="inline h-3 w-3 mr-1" />
                Numer telefonu klienta *
              </Label>
              <Input
                id="reschedule-phone"
                value={reschedulePhone}
                onChange={(e) => setReschedulePhone(e.target.value)}
                placeholder="+48 123 456 789"
              />
              <p className="text-xs text-muted-foreground">
                System znajdzie najblizszą wizyty klienta po numerze telefonu
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reschedule-appt-id">
                ID wizyty (opcjonalnie)
              </Label>
              <Input
                id="reschedule-appt-id"
                value={rescheduleAppointmentId}
                onChange={(e) => setRescheduleAppointmentId(e.target.value)}
                placeholder="np. abc-123-def..."
              />
              <p className="text-xs text-muted-foreground">
                Zostaw puste - system automatycznie znajdzie najblizszą wizyte
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="reschedule-date">
                  <Calendar className="inline h-3 w-3 mr-1" />
                  Nowa data *
                </Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reschedule-time">
                  <Clock className="inline h-3 w-3 mr-1" />
                  Preferowana godzina
                </Label>
                <Input
                  id="reschedule-time"
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Zostaw puste - system wybierze najblizszy wolny termin
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRescheduleForm(false);
                  setRescheduleResult(null);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={onReschedule}
                disabled={
                  rescheduleInProgress ||
                  !rescheduleDate ||
                  !reschedulePhone.trim()
                }
                className="gap-2"
              >
                {rescheduleInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calendar className="h-4 w-4" />
                )}
                Zmien termin
              </Button>
            </div>
          </div>
        )}

        {rescheduleResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-200">
                  Termin zmieniony pomyslnie!
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Asystent AI dokonal zmiany terminu przez telefon
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg">
              <div>
                <span className="text-xs text-muted-foreground">Usluga:</span>
                <p className="font-medium">{rescheduleResult.details.serviceName}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Pracownik:</span>
                <p className="font-medium">{rescheduleResult.details.employeeName}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Poprzedni termin:</span>
                <p className="font-medium text-muted-foreground line-through">
                  {rescheduleResult.details.oldDate} {rescheduleResult.details.oldTime}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Nowy termin:</span>
                <p className="font-medium text-primary">
                  {rescheduleResult.details.newDate} o {rescheduleResult.details.newTime}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Czas trwania:</span>
                <p className="font-medium">{rescheduleResult.details.duration} min</p>
              </div>
            </div>

            <div className="flex items-center gap-2 p-3 border rounded-lg">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                SMS z nowym terminem:{" "}
                {rescheduleResult.smsConfirmation.sent ? (
                  <Badge variant="default" className="bg-green-600 text-xs">
                    Wyslany na {rescheduleResult.smsConfirmation.phone}
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
                {rescheduleResult.details.appointmentId}
              </code>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setShowRescheduleForm(false);
                setRescheduleResult(null);
                setRescheduleDate("");
                setRescheduleTime("");
                setRescheduleAppointmentId("");
              }}
              className="w-full gap-2"
            >
              <Calendar className="h-4 w-4" />
              Nowa zmiana terminu
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

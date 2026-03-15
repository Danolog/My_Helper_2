"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Send,
  Shield,
  User,
  Volume2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type {
  VoiceAiConfig,
  CallSimulationResult,
  ServiceOption,
  BookingResult,
  RescheduleResult,
  CancelResult,
} from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceCallPanelProps {
  config: VoiceAiConfig;
  availableServices: ServiceOption[];
  /** Called after a successful action to refresh the call log */
  onCallLogRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Component — the call simulation tab with booking/reschedule/cancel flows
// ---------------------------------------------------------------------------

export function VoiceCallPanel({
  config,
  availableServices,
  onCallLogRefresh,
}: VoiceCallPanelProps) {
  // Call simulation state
  const [callerMessage, setCallerMessage] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [callResult, setCallResult] = useState<CallSimulationResult | null>(null);

  // Voice booking flow state
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingName, setBookingName] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);

  // Voice reschedule flow state
  const [reschedulePhone, setReschedulePhone] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState("");
  const [rescheduleInProgress, setRescheduleInProgress] = useState(false);
  const [rescheduleResult, setRescheduleResult] = useState<RescheduleResult | null>(null);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);

  // Voice cancellation flow state
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelAppointmentId, setCancelAppointmentId] = useState("");
  const [cancelInProgress, setCancelInProgress] = useState(false);
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);

  // Escalation message form state
  const [msgName, setMsgName] = useState("");
  const [msgPhone, setMsgPhone] = useState("");
  const [msgText, setMsgText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageResult, setMessageResult] = useState<{
    success: boolean;
    referenceNumber: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function simulateCall() {
    if (!callerMessage.trim()) return;
    if (!config.enabled) {
      toast.error("Asystent wylaczony", {
        description:
          "Wlacz asystenta glosowego AI w zakladce Konfiguracja, aby symulowac polaczenia.",
      });
      return;
    }

    setSimulating(true);
    setCallResult(null);
    setMessageResult(null);
    setMsgText("");
    try {
      const res = await fetch("/api/ai/voice/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerMessage: callerMessage.trim(),
          callerPhone: "+48 000 000 000",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCallResult(data);
        setCallerMessage("");
        onCallLogRefresh();
        // Auto-show forms based on detected intent
        if (data.intent === "book_appointment") {
          setShowBookingForm(true);
          setBookingResult(null);
        }
        if (data.intent === "reschedule") {
          setShowRescheduleForm(true);
          setRescheduleResult(null);
        }
        if (data.intent === "cancel_appointment") {
          setShowCancelForm(true);
          setCancelResult(null);
        }
      } else {
        const data = await res.json();
        toast.error("Blad symulacji", {
          description: data.error || "Nie udalo sie przetworzyc polaczenia.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSimulating(false);
    }
  }

  async function handleVoiceBooking() {
    if (!selectedServiceId) {
      toast.error("Wybierz usluge", {
        description: "Prosze wybrac usluge do rezerwacji.",
      });
      return;
    }

    if (!bookingPhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu dzwoniacego.",
      });
      return;
    }

    setBookingInProgress(true);
    setBookingResult(null);
    try {
      const res = await fetch("/api/ai/voice/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          preferredDate: bookingDate || undefined,
          preferredTime: bookingTime || undefined,
          callerPhone: bookingPhone.trim(),
          callerName: bookingName.trim() || undefined,
          notes: "Rezerwacja przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setBookingResult(data);
        toast.success("Wizyta zarezerwowana!", {
          description: `${data.details.serviceName} u ${data.details.employeeName}, ${data.details.date} o ${data.details.time}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie zarezerwowac", {
          description: data.error || "Prosze sprobowac inny termin.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setBookingInProgress(false);
    }
  }

  async function handleLeaveMessage() {
    if (!msgText.trim()) {
      toast.error("Wiadomosc wymagana", {
        description: "Prosze wpisac tresc wiadomosci.",
      });
      return;
    }
    if (!msgPhone.trim()) {
      toast.error("Numer telefonu wymagany", {
        description: "Prosze podac numer telefonu do kontaktu zwrotnego.",
      });
      return;
    }

    setSendingMessage(true);
    setMessageResult(null);
    try {
      const res = await fetch("/api/ai/voice/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: msgPhone.trim(),
          callerName: msgName.trim() || undefined,
          message: msgText.trim(),
          conversationId: callResult?.conversationId || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessageResult({
          success: true,
          referenceNumber: data.referenceNumber,
        });
        toast.success("Wiadomosc zapisana", {
          description: `Numer referencyjny: ${data.referenceNumber}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Blad", {
          description: data.error || "Nie udalo sie zapisac wiadomosci.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleVoiceReschedule() {
    if (!reschedulePhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu klienta.",
      });
      return;
    }

    if (!rescheduleDate) {
      toast.error("Nowy termin", {
        description: "Prosze podac nowa preferowana date.",
      });
      return;
    }

    setRescheduleInProgress(true);
    setRescheduleResult(null);
    try {
      const res = await fetch("/api/ai/voice/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: reschedulePhone.trim(),
          appointmentId: rescheduleAppointmentId.trim() || undefined,
          preferredDate: rescheduleDate || undefined,
          preferredTime: rescheduleTime || undefined,
          notes: "Zmiana terminu przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setRescheduleResult(data);
        toast.success("Termin zmieniony!", {
          description: `${data.details.serviceName}: ${data.details.oldDate} ${data.details.oldTime} → ${data.details.newDate} o ${data.details.newTime}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie zmienic terminu", {
          description: data.error || "Prosze sprobowac inny termin.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setRescheduleInProgress(false);
    }
  }

  async function handleVoiceCancel() {
    if (!cancelPhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu klienta.",
      });
      return;
    }

    setCancelInProgress(true);
    setCancelResult(null);
    try {
      const res = await fetch("/api/ai/voice/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: cancelPhone.trim(),
          appointmentId: cancelAppointmentId.trim() || undefined,
          notes: "Anulacja wizyty przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCancelResult(data);
        toast.success("Wizyta anulowana!", {
          description: `${data.details.serviceName} u ${data.details.employeeName}, ${data.details.date} o ${data.details.time}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie anulowac wizyty", {
          description: data.error || "Prosze sprobowac ponownie.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setCancelInProgress(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Call Simulation Input */}
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
                    simulateCall();
                  }
                }}
              />
              <Button
                onClick={simulateCall}
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
              {[
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
              ].map((msg) => (
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
              <p className="text-sm leading-relaxed">
                {callResult.response}
              </p>
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
                      Powod: {callResult.escalationReason || "Zapytanie wymaga interwencji czlowieka"}
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
                      <Badge variant="outline" className="gap-1 text-green-700 dark:text-green-300 border-green-400">
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
                          onClick={handleLeaveMessage}
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
                )}
              </div>
            )}

            {/* Availability Data Display */}
            {callResult.availabilityData && (
              <div className="p-4 border rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 space-y-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Dane z kalendarza (sprawdzenie dostepnosci)
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Data:</span>{" "}
                    <span className="font-medium">
                      {callResult.availabilityData.dateFormatted} ({callResult.availabilityData.date})
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pracownik:</span>{" "}
                    <span className="font-medium">
                      {callResult.availabilityData.employeeName}
                    </span>
                  </div>
                  {callResult.availabilityData.serviceName && (
                    <div>
                      <span className="text-muted-foreground">Usluga:</span>{" "}
                      <span className="font-medium">
                        {callResult.availabilityData.serviceName}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Czas trwania:</span>{" "}
                    <span className="font-medium">
                      {callResult.availabilityData.duration} min
                    </span>
                  </div>
                </div>

                {callResult.availabilityData.dayOff ? (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <XCircle className="h-3 w-3" />
                    Pracownik nie pracuje w tym dniu
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">
                      Godziny pracy: {callResult.availabilityData.workStart} - {callResult.availabilityData.workEnd}
                    </div>

                    {callResult.availabilityData.requestedTime && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Zapytany termin: {callResult.availabilityData.requestedTime}</span>
                        {callResult.availabilityData.requestedTimeAvailable === true && (
                          <Badge variant="default" className="bg-green-600 gap-1 text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            Dostepny
                          </Badge>
                        )}
                        {callResult.availabilityData.requestedTimeAvailable === false && (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <XCircle className="h-3 w-3" />
                            Zajety
                          </Badge>
                        )}
                      </div>
                    )}

                    {callResult.availabilityData.alternativeTimes.length > 0 && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Alternatywne terminy: </span>
                        <span className="font-medium">
                          {callResult.availabilityData.alternativeTimes.join(", ")}
                        </span>
                      </div>
                    )}

                    {/* Slots grid */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">
                        Dostepne terminy ({callResult.availabilityData.availableSlots.filter(s => s.available).length} wolnych / {callResult.availabilityData.availableSlots.length} wszystkich):
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {callResult.availabilityData.availableSlots.map((slot) => (
                          <span
                            key={slot.time}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              slot.available
                                ? slot.time === callResult.availabilityData?.requestedTime
                                  ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 ring-1 ring-green-400"
                                  : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                : slot.time === callResult.availabilityData?.requestedTime
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
            )}
          </CardContent>
        </Card>
      )}

      {/* Voice Booking Flow */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-blue-600" />
            Rezerwacja przez telefon
          </CardTitle>
          <CardDescription>
            Symuluj kompletny proces rezerwacji wizyty przez asystenta glosowego
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showBookingForm && !bookingResult && (
            <Button
              onClick={() => {
                setShowBookingForm(true);
                setBookingResult(null);
              }}
              variant="outline"
              className="w-full gap-2"
            >
              <PhoneCall className="h-4 w-4" />
              Rozpocznij rezerwacje telefoniczna
            </Button>
          )}

          {showBookingForm && !bookingResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
                <PhoneIncoming className="h-4 w-4 shrink-0" />
                Klient dzwoni i chce umowic wizyte. Wybierz usluge i termin, a AI dokona rezerwacji.
              </div>

              {/* Service Selection */}
              <div className="space-y-2">
                <Label>Usluga *</Label>
                <Select
                  value={selectedServiceId}
                  onValueChange={setSelectedServiceId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz usluge..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableServices.map((svc) => (
                      <SelectItem key={svc.id} value={svc.id}>
                        {svc.name} ({svc.price} PLN, {svc.duration} min)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date and Time */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="booking-date">
                    <Calendar className="inline h-3 w-3 mr-1" />
                    Preferowana data
                  </Label>
                  <Input
                    id="booking-date"
                    type="date"
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                  <p className="text-xs text-muted-foreground">
                    Zostaw puste - system wybierze jutrzejszy dzien
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking-time">
                    <Clock className="inline h-3 w-3 mr-1" />
                    Preferowana godzina
                  </Label>
                  <Input
                    id="booking-time"
                    type="time"
                    value={bookingTime}
                    onChange={(e) => setBookingTime(e.target.value)}
                    placeholder="HH:MM"
                  />
                  <p className="text-xs text-muted-foreground">
                    Zostaw puste - system wybierze pierwszy wolny termin
                  </p>
                </div>
              </div>

              {/* Caller Details */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="booking-phone">
                    <Phone className="inline h-3 w-3 mr-1" />
                    Numer telefonu *
                  </Label>
                  <Input
                    id="booking-phone"
                    value={bookingPhone}
                    onChange={(e) => setBookingPhone(e.target.value)}
                    placeholder="+48 123 456 789"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking-name">
                    <User className="inline h-3 w-3 mr-1" />
                    Imie i nazwisko klienta
                  </Label>
                  <Input
                    id="booking-name"
                    value={bookingName}
                    onChange={(e) => setBookingName(e.target.value)}
                    placeholder="Jan Kowalski"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowBookingForm(false);
                    setBookingResult(null);
                  }}
                >
                  Anuluj
                </Button>
                <Button
                  onClick={handleVoiceBooking}
                  disabled={bookingInProgress || !selectedServiceId}
                  className="gap-2"
                >
                  {bookingInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CalendarPlus className="h-4 w-4" />
                  )}
                  Zarezerwuj wizyte
                </Button>
              </div>
            </div>
          )}

          {/* Booking Result */}
          {bookingResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-green-800 dark:text-green-200">
                    Wizyta zarezerwowana pomyslnie!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Asystent AI dokonal rezerwacji przez telefon
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 p-4 border rounded-lg">
                <div>
                  <span className="text-xs text-muted-foreground">Usluga:</span>
                  <p className="font-medium">{bookingResult.details.serviceName}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Pracownik:</span>
                  <p className="font-medium">{bookingResult.details.employeeName}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Data:</span>
                  <p className="font-medium">{bookingResult.details.date}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Godzina:</span>
                  <p className="font-medium">{bookingResult.details.time}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Czas trwania:</span>
                  <p className="font-medium">{bookingResult.details.duration} min</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Cena:</span>
                  <p className="font-medium">{bookingResult.details.price} PLN</p>
                </div>
              </div>

              {/* SMS Confirmation Status */}
              <div className="flex items-center gap-2 p-3 border rounded-lg">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  SMS potwierdzajacy:{" "}
                  {bookingResult.smsConfirmation.sent ? (
                    <Badge variant="default" className="bg-green-600 text-xs">
                      Wyslany na {bookingResult.smsConfirmation.phone}
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
                  {bookingResult.appointment.id}
                </code>
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setShowBookingForm(false);
                  setBookingResult(null);
                  setSelectedServiceId("");
                  setBookingDate("");
                  setBookingTime("");
                  setBookingName("");
                }}
                className="w-full gap-2"
              >
                <PhoneCall className="h-4 w-4" />
                Nowa rezerwacja
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voice Reschedule Flow */}
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
                Klient dzwoni i chce zmienic termin wizyty. Podaj numer telefonu i nowy preferowany termin.
              </div>

              {/* Caller Phone */}
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

              {/* Optional: Direct appointment ID */}
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

              {/* New Date and Time */}
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
                  onClick={handleVoiceReschedule}
                  disabled={rescheduleInProgress || !rescheduleDate || !reschedulePhone.trim()}
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

          {/* Reschedule Result */}
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

              {/* SMS Confirmation Status */}
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

      {/* Voice Cancellation Flow */}
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
                Klient dzwoni i chce odwolac wizyte. Podaj numer telefonu, a system znajdzie najblizszа wizyte.
              </div>

              {/* Caller Phone */}
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

              {/* Optional: Direct appointment ID */}
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

              {/* Deposit Policy Info */}
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Polityka zadatku</p>
                  <p>Anulacja wiecej niz 24h przed wizyta: zadatek zwracany. Anulacja mniej niz 24h przed wizyta: zadatek zatrzymany przez salon.</p>
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
                  onClick={handleVoiceCancel}
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

          {/* Cancel Result */}
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

              {/* Deposit Policy Info */}
              <div className={`p-4 border rounded-lg space-y-2 ${
                cancelResult.depositInfo.depositPolicy === "refund"
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  : cancelResult.depositInfo.depositPolicy === "forfeit"
                    ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                    : "bg-muted/30"
              }`}>
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Informacja o zadatku
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Zadatek wplacony:</span>{" "}
                    <span className="font-medium">
                      {cancelResult.depositInfo.hasDeposit && cancelResult.depositInfo.depositPaid
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
                {cancelResult.depositInfo.depositRefunded && cancelResult.depositInfo.refund && (
                  <div className="flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Zwrot przetworzony: {cancelResult.depositInfo.refund.message}
                  </div>
                )}
              </div>

              {/* SMS Confirmation Status */}
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
    </div>
  );
}

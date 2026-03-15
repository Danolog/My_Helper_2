"use client";

// ---------------------------------------------------------------------------
// VoiceBookingForm — booking form card for creating appointments via the
// voice AI assistant. Shows a service selector, date/time pickers, caller
// details, and a success result after booking.
// ---------------------------------------------------------------------------

import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  User,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BookingResult, ServiceOption } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceBookingFormProps {
  availableServices: ServiceOption[];
  selectedServiceId: string;
  setSelectedServiceId: (value: string) => void;
  bookingDate: string;
  setBookingDate: (value: string) => void;
  bookingTime: string;
  setBookingTime: (value: string) => void;
  bookingPhone: string;
  setBookingPhone: (value: string) => void;
  bookingName: string;
  setBookingName: (value: string) => void;
  bookingInProgress: boolean;
  bookingResult: BookingResult | null;
  showBookingForm: boolean;
  setShowBookingForm: (value: boolean) => void;
  setBookingResult: (value: BookingResult | null) => void;
  onBook: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceBookingForm({
  availableServices,
  selectedServiceId,
  setSelectedServiceId,
  bookingDate,
  setBookingDate,
  bookingTime,
  setBookingTime,
  bookingPhone,
  setBookingPhone,
  bookingName,
  setBookingName,
  bookingInProgress,
  bookingResult,
  showBookingForm,
  setShowBookingForm,
  setBookingResult,
  onBook,
}: VoiceBookingFormProps) {
  return (
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
              Klient dzwoni i chce umowic wizyte. Wybierz usluge i termin, a AI
              dokona rezerwacji.
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
                onClick={onBook}
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
                <p className="font-medium">
                  {bookingResult.details.serviceName}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">
                  Pracownik:
                </span>
                <p className="font-medium">
                  {bookingResult.details.employeeName}
                </p>
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
                <span className="text-xs text-muted-foreground">
                  Czas trwania:
                </span>
                <p className="font-medium">
                  {bookingResult.details.duration} min
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Cena:</span>
                <p className="font-medium">
                  {bookingResult.details.price} PLN
                </p>
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
  );
}

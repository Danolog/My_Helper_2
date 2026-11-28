"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  Scissors,
  Package,
  DollarSign,
  ClipboardList,
  CalendarPlus,
  CalendarClock,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { mutationFetch } from "@/lib/api-client";
// Moduł bez importów serwerowych — bezpieczny w kodzie klienta.
import { COMPLETE_MESSAGES } from "@/lib/appointment-completion";
import { DEFAULT_COMMISSION_RATE } from "@/lib/constants";

/**
 * Metody płatności — ta sama lista co `APPOINTMENT_PAYMENT_METHODS` w
 * `@/lib/api-validation`. Kopia, bo tamten moduł wciąga walidacje całego API;
 * zgodność pilnuje test komponentu.
 */
export const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Gotówka" },
  { value: "card", label: "Karta" },
  { value: "blik", label: "BLIK" },
] as const;

type PaymentMethod = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];

/**
 * Teksty błędów kwoty — kopia tekstów schematu `completeAppointmentSchema`
 * (`@/lib/api-validation`), z tego samego powodu co lista metod. Okno sprawdza
 * pole przed wysłaniem tymi samymi słowami, które oddałby serwer; równość
 * pilnuje test komponentu.
 */
export const PAID_AMOUNT_MESSAGES = {
  required: COMPLETE_MESSAGES.paidAmountRequired,
  notNumber: "Kwota musi być liczbą.",
  negative: "Kwota nie może być ujemna.",
  tooManyDecimals: "Kwota może mieć najwyżej 2 miejsca po przecinku.",
  outOfRange: "Kwota musi być liczbą od 0 do 99 999 999,99.",
} as const;

/** Ten sam wzorzec co na serwerze: do 8 cyfr przed kropką, najwyżej 2 po niej (numeric(10,2)). */
const PAID_AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

const RECEIPT_NOTICE =
  "Kwota trafi tylko do raportu w MyHelper. To nie jest paragon. Paragon wystaw jak zwykle w kasie fiskalnej.";

const COMPLETE_FAILED_MESSAGE = "Nie udało się zakończyć wizyty. Spróbuj ponownie.";

type PaidAmountCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Kwota wpisana w oknie → tekst z kropką dla trasy zakończenia. Przycięcie
 * spacji i przecinek na kropkę przed sprawdzeniem; kolejność warunków jak w
 * schemacie serwera. Jedna różnica: tekst niebędący liczbą („abc”) serwer
 * opisuje zakresem, a okno krótko „Kwota musi być liczbą.” — zakres zostaje
 * dla liczby za dużej dla kolumny.
 */
export function checkPaidAmount(raw: string): PaidAmountCheck {
  const value = raw.trim().replace(/,/g, ".");
  if (value === "") return { ok: false, error: PAID_AMOUNT_MESSAGES.required };
  if (value.startsWith("-")) return { ok: false, error: PAID_AMOUNT_MESSAGES.negative };
  if (/^\d+\.\d{3,}$/.test(value)) return { ok: false, error: PAID_AMOUNT_MESSAGES.tooManyDecimals };
  if (/^\d+(\.\d{1,2})?$/.test(value) && !PAID_AMOUNT_PATTERN.test(value)) {
    return { ok: false, error: PAID_AMOUNT_MESSAGES.outOfRange };
  }
  if (!PAID_AMOUNT_PATTERN.test(value)) return { ok: false, error: PAID_AMOUNT_MESSAGES.notNumber };
  return { ok: true, value };
}

/** Kwota z bazy (numeric jako tekst) albo liczba → grosze; brak albo nieczytelna → null. */
function toCents(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

/**
 * Domyślna kwota w polu: cena usługi (`service.basePrice`) pomniejszona o rabat
 * zapisany na wizycie przy rezerwacji z kodem (`discountAmount`), nie mniejsza
 * niż 0, z przecinkiem i dwoma miejscami. Tak samo liczą raporty przychodu.
 * Rachunek w groszach, żeby uniknąć wyników w rodzaju 89,88999.
 * Brak ceny (albo cena nieczytelna) — puste pole, nie „0,00”, także z rabatem.
 * Rabat pusty, nieczytelny albo ujemny liczy się jak 0.
 */
export function defaultPaidAmount(
  basePrice: string | null | undefined,
  discountAmount?: string | number | null
): string {
  const priceCents = toCents(basePrice);
  if (priceCents === null) return "";
  const discountCents = toCents(discountAmount);
  const appliedDiscount = discountCents !== null && discountCents > 0 ? discountCents : 0;
  const paidCents = Math.max(0, priceCents - appliedDiscount);
  return (paidCents / 100).toFixed(2).replace(".", ",");
}

/** Czas animacji zamknięcia okna — pola czyszczą się dopiero po niej. */
const RESET_AFTER_CLOSE_MS = 300;

type PaymentFieldErrors = { paidAmount?: string | undefined; paymentMethod?: string | undefined };

interface MaterialRecord {
  id: string;
  product: {
    name: string;
    pricePerUnit: string | null;
    unit: string | null;
  } | null;
  quantityUsed: string;
}

interface AppointmentData {
  id: string;
  employeeId: string;
  status: string;
  /** Rabat z kodu promocyjnego zapisany na wizycie; brak = bez rabatu. */
  discountAmount?: string | number | null;
  service: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
    suggestedNextVisitDays?: number | null;
  } | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface ScheduleNextData {
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  employeeId: string;
  suggestedDate: string; // YYYY-MM-DD
}

interface CompleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  materials: MaterialRecord[];
  onCompleted: () => void;
  onScheduleNext?: (data: ScheduleNextData) => void;
}

export function CompleteAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  materials,
  onCompleted,
  onScheduleNext,
}: CompleteAppointmentDialogProps) {
  // Rola z kontekstu panelu: prowizję, jej stawkę i koszt materiałów widzi
  // (i wysyła) tylko właściciel. Recepcja i pracownik zapisują prowizję według
  // stawki pracownika, którą serwer bierze sam.
  const isOwner = useSalonRole() === "owner";
  const initialPaidAmount = defaultPaidAmount(
    appointment.service?.basePrice,
    appointment.discountAmount
  );

  const [recipe, setRecipe] = useState("");
  const [techniques, setTechniques] = useState("");
  const [notes, setNotes] = useState("");
  const [commissionPercentage, setCommissionPercentage] = useState(String(DEFAULT_COMMISSION_RATE));
  const [paidAmount, setPaidAmount] = useState(initialPaidAmount);
  // Bez wartości domyślnej: salon wybiera metodę świadomie przy każdej wizycie.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PaymentFieldErrors>({});
  const [completing, setCompleting] = useState(false);
  const [completedSuccessfully, setCompletedSuccessfully] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);

  const [formAppointmentId, setFormAppointmentId] = useState(appointment.id);
  // Czyszczenie pól odłożone do końca animacji zamknięcia.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Podmiana wizyty (albo odmontowanie) anuluje odłożone czyszczenie: inaczej
  // timer zamkniętej wizyty wpisałby jej kwotę do pola następnej wizyty.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, [appointment.id]);

  const handleGenerateAISummary = async () => {
    setGeneratingSummary(true);
    try {
      const res = await fetch("/api/ai/appointments/auto-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appointment.id }),
      });
      const data = await res.json();
      if (data.success && data.summary) {
        setAiSummaryText(data.summary.fullSummary);
        toast.success("Podsumowanie AI wygenerowane");
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Podsumowanie AI dostępne tylko w Planie Pro");
      } else {
        toast.error(data.error || "Nie udało się wygenerować podsumowania");
      }
    } catch {
      toast.error("Błąd generowania podsumowania AI");
    } finally {
      setGeneratingSummary(false);
    }
  };

  // Calculate material cost
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return (
        sum +
        parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit)
      );
    }
    return sum;
  }, 0);

  // Calculate commission
  const servicePrice = appointment.service
    ? parseFloat(appointment.service.basePrice)
    : 0;
  const commPct = parseFloat(commissionPercentage) || 0;
  const commissionAmount = (servicePrice * commPct) / 100;

  // Calculate suggested next visit date
  const getSuggestedDate = (): string => {
    const days = appointment.service?.suggestedNextVisitDays;
    const suggestedDays = days && days > 0 ? days : 30; // Default 30 days
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + suggestedDays);
    const yyyy = nextDate.getFullYear();
    const mm = String(nextDate.getMonth() + 1).padStart(2, "0");
    const dd = String(nextDate.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getSuggestedDaysLabel = (): string => {
    const days = appointment.service?.suggestedNextVisitDays;
    const suggestedDays = days && days > 0 ? days : 30;
    if (suggestedDays % 7 === 0) {
      const weeks = suggestedDays / 7;
      return weeks === 1 ? "1 tydzień" : `${weeks} tygodni`;
    }
    return `${suggestedDays} dni`;
  };

  const handleComplete = async () => {
    // Sprawdzenie przed wysłaniem: przy błędzie żądanie nie wychodzi, a tekst
    // stoi pod polem. Okno nigdy nie wysyła pustej kwoty ani pustej metody.
    const amountCheck = checkPaidAmount(paidAmount);
    const errors: PaymentFieldErrors = {};
    if (!amountCheck.ok) errors.paidAmount = amountCheck.error;
    if (paymentMethod === null) errors.paymentMethod = COMPLETE_MESSAGES.paymentMethodRequired;
    setFieldErrors(errors);
    if (!amountCheck.ok || paymentMethod === null) return;

    setCompleting(true);
    try {
      const res = await mutationFetch(
        `/api/appointments/${appointment.id}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipe: recipe || null,
            techniques: techniques || null,
            notes: notes || null,
            paidAmount: amountCheck.value,
            paymentMethod,
            // Stawkę dla tej wizyty podaje tylko właściciel; inne role nie
            // wysyłają pola, więc serwer liczy prowizję według stawki pracownika.
            ...(isOwner ? { commissionPercentage: commPct } : {}),
          }),
        }
      );

      const data = await res.json();
      if (data.success) {
        toast.success(COMPLETE_MESSAGES.success);
        setCompletedSuccessfully(true);
        onCompleted();
        return;
      }
      // 400 z walidacji: teksty pól pod polami, ogólny tekst w toaście.
      // Okno zostaje otwarte z wpisanymi danymi.
      const details: Record<string, unknown> =
        data.details && typeof data.details === "object" ? data.details : {};
      const serverErrors: PaymentFieldErrors = {};
      if (typeof details.paidAmount === "string") serverErrors.paidAmount = details.paidAmount;
      if (typeof details.paymentMethod === "string") serverErrors.paymentMethod = details.paymentMethod;
      setFieldErrors(serverErrors);
      toast.error(typeof data.error === "string" && data.error ? data.error : COMPLETE_FAILED_MESSAGE);
    } catch {
      toast.error(COMPLETE_FAILED_MESSAGE);
    } finally {
      setCompleting(false);
    }
  };

  const resetForm = () => {
    setCompletedSuccessfully(false);
    setRecipe("");
    setTechniques("");
    setNotes("");
    setCommissionPercentage(String(DEFAULT_COMMISSION_RATE));
    setPaidAmount(initialPaidAmount);
    setPaymentMethod(null);
    setFieldErrors({});
    setAiSummaryText(null);
  };

  // Kalendarz trzyma okno zamontowane i podmienia wizytę: cały formularz
  // zaczyna od nowa dla innej wizyty, z jej domyślną kwotą (zmiana stanu w
  // renderze zamiast efektu — wzorzec z dokumentacji Reacta). Pełny reset,
  // bo odłożone czyszczenie poprzedniej wizyty zostaje anulowane.
  if (formAppointmentId !== appointment.id) {
    setFormAppointmentId(appointment.id);
    resetForm();
  }

  const scheduleResetAfterClose = () => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      resetForm();
    }, RESET_AFTER_CLOSE_MS);
  };

  const handleScheduleNext = () => {
    if (!onScheduleNext) return;

    const data: ScheduleNextData = {
      clientId: appointment.client?.id || "",
      clientName: appointment.client
        ? `${appointment.client.firstName} ${appointment.client.lastName}`
        : "",
      serviceId: appointment.service?.id || "",
      serviceName: appointment.service?.name || "",
      employeeId: appointment.employeeId,
      suggestedDate: getSuggestedDate(),
    };

    onOpenChange(false);
    scheduleResetAfterClose();

    onScheduleNext(data);
  };

  const handleClose = () => {
    onOpenChange(false);
    scheduleResetAfterClose();
  };

  // Zamknięcie formularza (Esc, klik poza oknem, Anuluj) też czyści pola.
  const handleFormOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    handleClose();
  };

  // Show success state with "Schedule Next" prompt
  if (completedSuccessfully) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-md"
          data-testid="complete-appointment-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Wizyta zakończona
            </DialogTitle>
            <DialogDescription>
              Wizyta została pomyślnie zakończona
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary of completed appointment */}
            <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Scissors className="h-4 w-4 text-green-700 dark:text-green-400" />
                <span className="font-medium text-green-800 dark:text-green-300">
                  {appointment.service?.name || "Wizyta"}
                </span>
              </div>
              {appointment.client && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  Klient: {appointment.client.firstName} {appointment.client.lastName}
                </p>
              )}
              {appointment.employee && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  Pracownik: {appointment.employee.firstName} {appointment.employee.lastName}
                </p>
              )}
            </div>

            {/* AI Summary generation */}
            <div className="space-y-2" data-testid="ai-summary-prompt">
              {aiSummaryText ? (
                <div className="rounded-lg border p-3 bg-primary/5 border-primary/20">
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="font-medium">Podsumowanie AI</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{aiSummaryText}</p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateAISummary}
                  disabled={generatingSummary}
                  className="w-full"
                  data-testid="generate-summary-btn"
                >
                  {generatingSummary ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generowanie podsumowania...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generuj podsumowanie AI
                    </>
                  )}
                </Button>
              )}
            </div>

            <Separator />

            {/* Schedule next appointment prompt */}
            <div className="space-y-3" data-testid="schedule-next-prompt">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Umów następną wizytę?</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Sugerowany termin następnej wizyty: za{" "}
                <span className="font-medium text-foreground">
                  {getSuggestedDaysLabel()}
                </span>{" "}
                ({new Date(getSuggestedDate()).toLocaleDateString("pl-PL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })})
              </p>

              {appointment.client && appointment.service && (
                <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Klient:</span>{" "}
                    <span className="font-medium">
                      {appointment.client.firstName} {appointment.client.lastName}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Usługa:</span>{" "}
                    <span className="font-medium">{appointment.service.name}</span>
                  </p>
                  {appointment.employee && (
                    <p>
                      <span className="text-muted-foreground">Pracownik:</span>{" "}
                      <span className="font-medium">
                        {appointment.employee.firstName} {appointment.employee.lastName}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              data-testid="skip-schedule-next-btn"
            >
              Nie teraz
            </Button>
            <Button
              onClick={handleScheduleNext}
              disabled={!onScheduleNext}
              data-testid="schedule-next-btn"
            >
              <CalendarPlus className="h-4 w-4 mr-2" />
              Umów następną wizytę
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleFormOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        data-testid="complete-appointment-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Zakończ wizytę
          </DialogTitle>
          <DialogDescription>
            Wypełnij notatki z zabiegu i potwierdź zakończenie wizyty
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Appointment summary */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm mb-1">
              <Scissors className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {appointment.service?.name || "Wizyta"}
              </span>
              <Badge variant="secondary">
                {servicePrice.toFixed(2)} PLN
              </Badge>
            </div>
            {appointment.client && (
              <p className="text-sm text-muted-foreground">
                Klient: {appointment.client.firstName}{" "}
                {appointment.client.lastName}
              </p>
            )}
            {appointment.employee && (
              <p className="text-sm text-muted-foreground">
                Pracownik: {appointment.employee.firstName}{" "}
                {appointment.employee.lastName}
              </p>
            )}
          </div>

          <Separator />

          {/* Płatność — wymagana dla każdej roli */}
          <div className="space-y-4" data-testid="payment-section">
            <div>
              <Label htmlFor="paid-amount">
                Kwota zapłacona przez klienta (zł)
                <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                id="paid-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                aria-required="true"
                aria-invalid={fieldErrors.paidAmount ? true : undefined}
                aria-describedby={fieldErrors.paidAmount ? "paid-amount-error" : undefined}
                value={paidAmount}
                onChange={(e) => {
                  setPaidAmount(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, paidAmount: undefined }));
                }}
                placeholder="np. 120,00"
                data-testid="paid-amount-input"
              />
              {fieldErrors.paidAmount && (
                <p
                  id="paid-amount-error"
                  className="mt-1 text-sm text-destructive"
                  data-testid="paid-amount-error"
                >
                  {fieldErrors.paidAmount}
                </p>
              )}
            </div>

            <div>
              <p id="payment-method-label" className="text-sm font-medium leading-none mb-2">
                Metoda płatności
                <span aria-hidden="true" className="text-destructive">*</span>
              </p>
              <div
                role="radiogroup"
                aria-labelledby="payment-method-label"
                aria-required="true"
                aria-invalid={fieldErrors.paymentMethod ? true : undefined}
                aria-describedby={fieldErrors.paymentMethod ? "payment-method-error" : undefined}
                className="flex flex-wrap gap-2"
                data-testid="payment-method-group"
              >
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value={option.value}
                      checked={paymentMethod === option.value}
                      onChange={() => {
                        setPaymentMethod(option.value);
                        setFieldErrors((prev) => ({ ...prev, paymentMethod: undefined }));
                      }}
                      data-testid={`payment-method-${option.value}`}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {fieldErrors.paymentMethod && (
                <p
                  id="payment-method-error"
                  className="mt-1 text-sm text-destructive"
                  data-testid="payment-method-error"
                >
                  {fieldErrors.paymentMethod}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground" data-testid="receipt-notice">
              {RECEIPT_NOTICE}
            </p>
          </div>

          <Separator />

          {/* Treatment notes section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Notatki z zabiegu</h3>
            </div>

            <div>
              <Label htmlFor="recipe">Receptura</Label>
              <Textarea
                id="recipe"
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
                placeholder="np. Kolor 6/0 + 7/0 w proporcji 1:1, utleniacz 6%"
                rows={2}
                data-testid="treatment-recipe-input"
              />
            </div>

            <div>
              <Label htmlFor="techniques">Techniki</Label>
              <Textarea
                id="techniques"
                value={techniques}
                onChange={(e) => setTechniques(e.target.value)}
                placeholder="np. Baleyage, cieniowanie"
                rows={2}
                data-testid="treatment-techniques-input"
              />
            </div>

            <div>
              <Label htmlFor="treatment-notes">Notatki dodatkowe</Label>
              <Textarea
                id="treatment-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="np. Klientka preferuje cieplejsze odcienie, następna wizyta za 6 tygodni"
                rows={2}
                data-testid="treatment-notes-input"
              />
            </div>
          </div>

          {/* Materiały z kosztem i prowizja — tylko właściciel */}
          {isOwner && (
            <>
              <Separator />

              {/* Materials summary */}
              <div className="space-y-2" data-testid="materials-section">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">
                    Użyte materiały ({materials.length})
                  </h3>
                </div>
                {materials.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    Brak dodanych materiałów
                  </p>
                ) : (
                  <div className="space-y-1">
                    {materials.map((m) => (
                      <div
                        key={m.id}
                        className="flex justify-between text-sm"
                      >
                        <span>
                          {m.product?.name || "Nieznany"} ({m.quantityUsed}{" "}
                          {m.product?.unit || "szt."})
                        </span>
                        {m.product?.pricePerUnit && (
                          <span className="text-muted-foreground">
                            {(
                              parseFloat(m.quantityUsed) *
                              parseFloat(m.product.pricePerUnit)
                            ).toFixed(2)}{" "}
                            PLN
                          </span>
                        )}
                      </div>
                    ))}
                    {totalMaterialCost > 0 && (
                      <div className="flex justify-between text-sm font-medium pt-1 border-t">
                        <span>Łączny koszt materiałów:</span>
                        <span>{totalMaterialCost.toFixed(2)} PLN</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Commission section */}
              <div className="space-y-3" data-testid="commission-section">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Prowizja pracownika</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Label htmlFor="commission-pct">Procent prowizji (%)</Label>
                    <Input
                      id="commission-pct"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={commissionPercentage}
                      onChange={(e) => setCommissionPercentage(e.target.value)}
                      data-testid="commission-percentage-input"
                    />
                  </div>
                  <div className="flex-1">
                    <Label>Kwota prowizji</Label>
                    <div
                      className="h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-medium"
                      data-testid="commission-amount-display"
                    >
                      {commissionAmount.toFixed(2)} PLN
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cena usługi: {servicePrice.toFixed(2)} PLN x{" "}
                  {commPct.toFixed(0)}% = {commissionAmount.toFixed(2)} PLN
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose}>
            Anuluj
          </Button>
          <Button
            onClick={handleComplete}
            disabled={completing}
            data-testid="confirm-complete-btn"
          >
            {completing ? (
              "Kończenie…"
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Zakończ wizytę
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

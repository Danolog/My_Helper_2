// Zakończenie wizyty (status `completed`) — reguły wspólne dla tras wizyty.
//
// Wizytę zamyka wyłącznie POST /api/appointments/[id]/complete: tam w jednej
// transakcji zapisuje się status, płatność, prowizja i zużycie materiałów.
// Wizyta zakończona ma ostateczny wynik — żadna trasa nie zmienia już jej
// statusu (przywrócenie, anulowanie, „Nie przyszedł”).
// Moduł bez importów serwerowych.
import { APPOINTMENT_ERROR_CODES } from "@/lib/appointment-codes";

/** Status wizyty zakończonej. */
export const COMPLETED_STATUS = "completed";

/** Kod 400 z PUT /api/appointments/[id], gdy ktoś ustawia `completed` poza trasą zakończenia. */
export const COMPLETE_DEDICATED_ROUTE_CODE = "COMPLETE_DEDICATED_ROUTE";
export const COMPLETE_DEDICATED_ROUTE_MESSAGE = "Wizytę zakończ przyciskiem Zakończ wizytę";

/**
 * Kod 409, gdy trasa próbuje zmienić wizytę zakończoną czymś innym niż
 * notatki (termin, pracownik, usługa, klient, zadatek, status) albo ją anulować.
 */
export const APPOINTMENT_COMPLETED_CODE = "APPOINTMENT_COMPLETED";
export const APPOINTMENT_COMPLETED_MESSAGE =
  "Zakończonej wizyty nie można zmienić. Możesz edytować tylko notatki.";

/**
 * Kody błędów POST /api/appointments/[id]/complete (pole `code` każdej
 * odpowiedzi 4xx poza 401 z `requireAuth`). Brak wizyty, zły identyfikator,
 * brak salonu i wizyta anulowana — wspólne kody wizyty z `@/lib/appointment-codes`.
 * Wizyta zakończona: 409 `APPOINTMENT_COMPLETED` jak w PUT i DELETE;
 * „Nie przyszedł”: 409 `APPOINTMENT_NO_SHOW` z `@/lib/no-show`.
 */
export const COMPLETE_ERROR_CODES = {
  ...APPOINTMENT_ERROR_CODES,
  invalidJson: "INVALID_JSON",
  validationFailed: "VALIDATION_FAILED",
  /** 400: brak kwoty zapłaconej (pole pominięte albo null). */
  paidAmountRequired: "PAID_AMOUNT_REQUIRED",
  /** 400: brak metody płatności (pole pominięte albo null). */
  paymentMethodRequired: "PAYMENT_METHOD_REQUIRED",
  servicePriceInvalid: "SERVICE_PRICE_INVALID",
  commissionRateInvalid: "COMMISSION_RATE_INVALID",
} as const;

/**
 * Teksty `error` (i `message` sukcesu) trasy zakończenia — dialog pokazuje je
 * w toaście, więc mówią salonowi, co się stało i kto może to poprawić.
 * Wizyta zakończona ma tu własny tekst; PUT i DELETE zostają przy
 * `APPOINTMENT_COMPLETED_MESSAGE` (ten sam kod).
 */
export const COMPLETE_MESSAGES = {
  salonNotFound: "Nie znaleziono salonu przypisanego do Twojego konta. Zaloguj się ponownie.",
  invalidId: "Nie rozpoznano tej wizyty. Odśwież stronę i spróbuj ponownie.",
  invalidJson: "Nie udało się odczytać danych formularza. Odśwież stronę i spróbuj ponownie.",
  validationFailed: "Sprawdź dane w formularzu.",
  /** 400 `PAID_AMOUNT_REQUIRED` — także tekst błędu pola `paidAmount` w schemacie. */
  paidAmountRequired: "Podaj kwotę zapłaconą przez klienta.",
  /** 400 `PAYMENT_METHOD_REQUIRED` — także tekst błędu pola `paymentMethod` w schemacie. */
  paymentMethodRequired: "Wybierz metodę płatności.",
  appointmentNotFound:
    "Nie znaleziono tej wizyty albo nie jest już przypisana do Ciebie. Odśwież kalendarz.",
  appointmentCompleted: "Ta wizyta jest już zakończona. Odśwież widok, żeby zobaczyć zapisane dane.",
  appointmentCancelled: "Tej wizyty nie można zakończyć, bo została anulowana.",
  /**
   * „Nie przyszedł” dla pracownika: oznaczenie cofają tylko właściciel i
   * recepcja (`NO_SHOW_MARK_ROLES`), więc pracownik nie dostaje polecenia,
   * którego nie może wykonać. Pozostałe role — tekst z `@/lib/no-show`.
   */
  noShowEmployee:
    "Wizyta oznaczona jako »Nie przyszedł«. Właściciel lub recepcja może cofnąć oznaczenie.",
  /** 409: cena podstawowa usługi nie jest liczbą skończoną ≥ 0. */
  servicePriceInvalid:
    "Nie można policzyć prowizji: cena tej usługi jest zapisana nieprawidłowo. Wizyta nie została zakończona. Właściciel salonu może poprawić cenę w ustawieniach usługi.",
  /** 409: indywidualna cena pracownika nie jest liczbą skończoną ≥ 0. */
  employeePriceInvalid:
    "Nie można policzyć prowizji: indywidualna cena pracownika za tę usługę jest zapisana nieprawidłowo. Wizyta nie została zakończona. Właściciel salonu może ją poprawić w karcie „Ceny indywidualne pracowników” tej usługi.",
  /** 409: stawka prowizji z danych pracownika nie jest liczbą skończoną. */
  commissionRateInvalid:
    "Nie można policzyć prowizji: stawka prowizji pracownika jest zapisana nieprawidłowo. Wizyta nie została zakończona. Właściciel salonu może ją poprawić w zakładce Finanse.",
  /** 500: cała trasa działa w jednej transakcji, więc nic się nie zapisało. */
  serverError: "Nie udało się zakończyć wizyty. Nic nie zostało zapisane. Spróbuj ponownie za chwilę.",
  success: "Wizyta zakończona.",
} as const;

/**
 * Prowizja od ceny usługi. Stawka zaokrąglona do 2 miejsc (precyzja kolumny
 * `percentage`) PRZED liczeniem kwoty, więc kwota zgadza się z zapisaną stawką.
 * Liczenie w groszach i setnych procenta na liczbach całkowitych; kwota
 * zaokrąglona do pełnego grosza. Wejście musi być liczbą skończoną.
 */
export function commissionFor(price: number, ratePercent: number): { amount: string; percentage: string } {
  const rateHundredths = Math.round(ratePercent * 100);
  const priceCents = Math.round(price * 100);
  const amountCents = Math.round((priceCents * rateHundredths) / 10_000);
  return {
    amount: (amountCents / 100).toFixed(2),
    percentage: (rateHundredths / 100).toFixed(2),
  };
}

/** Bieżące wartości wizyty, z którymi porównujemy pola z PUT. */
export interface CompletedAppointmentCurrent {
  startTime: Date | string;
  endTime: Date | string;
  employeeId: string | null;
  clientId: string | null;
  serviceId: string | null;
  status: string;
  depositAmount: string | null;
  depositPaid: boolean | null;
}

/** Pola z PUT /api/appointments/[id] po walidacji schematem. */
export interface AppointmentEditInput {
  startTime?: string | undefined;
  endTime?: string | undefined;
  employeeId?: string | undefined;
  clientId?: string | null | undefined;
  serviceId?: string | null | undefined;
  status?: string | undefined;
  depositAmount?: string | null | undefined;
  depositPaid?: boolean | undefined;
}

function sameInstant(next: string, current: Date | string): boolean {
  return new Date(next).getTime() === new Date(current).getTime();
}

/** Kwota zadatku: null = brak; napisy porównane jako liczby ("50" = "50.00"). */
function sameDepositAmount(next: string | null, current: string | null): boolean {
  if (next === null || current === null) return next === current;
  const a = Number(next);
  const b = Number(current);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/**
 * Pola spoza notatek, które PUT zmieniłby na wizycie zakończonej. Pole liczy
 * się tylko wtedy, gdy różni się od bieżącej wartości — formularz wysyłający
 * cały obiekt z niezmienionymi polami nie blokuje zapisu notatek. Puste
 * `employeeId` trasa i tak pomija, więc tu też nie jest zmianą.
 */
export function completedAppointmentChangedFields(
  current: CompletedAppointmentCurrent,
  input: AppointmentEditInput
): string[] {
  const changed: string[] = [];
  if (input.startTime !== undefined && !sameInstant(input.startTime, current.startTime)) {
    changed.push("startTime");
  }
  if (input.endTime !== undefined && !sameInstant(input.endTime, current.endTime)) {
    changed.push("endTime");
  }
  if (input.employeeId && input.employeeId !== current.employeeId) changed.push("employeeId");
  if (input.clientId !== undefined && input.clientId !== current.clientId) changed.push("clientId");
  if (input.serviceId !== undefined && input.serviceId !== current.serviceId) changed.push("serviceId");
  if (input.status !== undefined && input.status !== current.status) changed.push("status");
  if (
    input.depositAmount !== undefined &&
    !sameDepositAmount(input.depositAmount, current.depositAmount)
  ) {
    changed.push("depositAmount");
  }
  if (input.depositPaid !== undefined && input.depositPaid !== (current.depositPaid === true)) {
    changed.push("depositPaid");
  }
  return changed;
}

/**
 * Wizyta okazała się zakończona przy zapisie (stan po blokadzie wiersza albo
 * warunek w UPDATE). Rzucany w transakcji, żeby wycofać wszystkie jej zapisy;
 * trasa mapuje go na 409 `APPOINTMENT_COMPLETED`.
 */
export class AppointmentCompletedError extends Error {
  constructor() {
    super("Appointment is completed");
    this.name = "AppointmentCompletedError";
  }
}

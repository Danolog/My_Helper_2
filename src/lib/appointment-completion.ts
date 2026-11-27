// Zakończenie wizyty (status `completed`) — reguły wspólne dla tras wizyty.
//
// Wizytę zamyka wyłącznie POST /api/appointments/[id]/complete: tam w jednej
// transakcji zapisuje się status, płatność, prowizja i zużycie materiałów.
// Wizyta zakończona ma ostateczny wynik — żadna trasa nie zmienia już jej
// statusu (przywrócenie, anulowanie, „Nie przyszedł”).
// Moduł bez importów serwerowych.

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
 * odpowiedzi 4xx poza 401 z `requireAuth`). Wizyta zakończona: 409
 * `APPOINTMENT_COMPLETED` jak w PUT i DELETE; „Nie przyszedł”: 409
 * `APPOINTMENT_NO_SHOW` z `@/lib/no-show`.
 */
export const COMPLETE_ERROR_CODES = {
  invalidJson: "INVALID_JSON",
  invalidId: "INVALID_APPOINTMENT_ID",
  validationFailed: "VALIDATION_FAILED",
  salonNotFound: "SALON_NOT_FOUND",
  appointmentNotFound: "APPOINTMENT_NOT_FOUND",
  appointmentCancelled: "APPOINTMENT_CANCELLED",
  servicePriceInvalid: "SERVICE_PRICE_INVALID",
  commissionRateInvalid: "COMMISSION_RATE_INVALID",
} as const;

/** 409: cena usługi (podstawowa albo pracownika) nie jest liczbą skończoną. */
export const SERVICE_PRICE_INVALID_MESSAGE =
  "Cena usługi jest nieprawidłowa. Popraw cenę usługi i zakończ wizytę ponownie.";
/** 409: domyślna stawka prowizji pracownika nie jest liczbą skończoną. */
export const COMMISSION_RATE_INVALID_MESSAGE =
  "Stawka prowizji pracownika jest nieprawidłowa. Popraw ją w danych pracownika i zakończ wizytę ponownie.";

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

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

/** Kod 409, gdy trasa próbuje zmienić status wizyty zakończonej. */
export const APPOINTMENT_COMPLETED_CODE = "APPOINTMENT_COMPLETED";
export const APPOINTMENT_COMPLETED_MESSAGE = "Wizyta jest zakończona — jej statusu nie można zmienić";

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

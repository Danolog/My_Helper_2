// Kody błędów wspólne dla tras jednej wizyty (/api/appointments/[id]/...).
//
// Pole `code` odpowiedzi 4xx. Ta sama sytuacja ma w każdej trasie ten sam kod
// i ten sam status HTTP, więc panel może rozpoznać ją po kodzie, a nie po
// treści komunikatu. Teksty komunikatów zostają przy trasach.
// Moduł bez importów serwerowych.

/**
 * - `appointmentNotFound` — 404: brak wizyty w salonie z sesji (albo pracownik
 *   pyta o cudzą wizytę; odpowiedź nie zdradza, że wizyta istnieje);
 * - `invalidId` — 400: identyfikator wizyty nie jest UUID (przed bazą);
 * - `salonNotFound` — 404: sesja bez salonu;
 * - `appointmentCancelled` — 400: wizyta jest anulowana.
 */
export const APPOINTMENT_ERROR_CODES = {
  appointmentNotFound: "APPOINTMENT_NOT_FOUND",
  invalidId: "INVALID_APPOINTMENT_ID",
  salonNotFound: "SALON_NOT_FOUND",
  appointmentCancelled: "APPOINTMENT_CANCELLED",
} as const;

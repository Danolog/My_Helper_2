// Kody błędów wspólne dla tras jednej wizyty (/api/appointments/[id]/...).
//
// Pole `code` odpowiedzi 4xx. Ta sama sytuacja ma w każdej trasie ten sam kod
// i ten sam status HTTP, więc panel może rozpoznać ją po kodzie, a nie po
// treści komunikatu. Teksty komunikatów zostają przy trasach.
//
// Kody wizyty spoza tego modułu:
// - `APPOINTMENT_COMPLETED` (409, wizyta zakończona) — `@/lib/appointment-completion`
//   (`APPOINTMENT_COMPLETED_CODE`), ten sam status w complete, PUT i DELETE;
// - `APPOINTMENT_NO_SHOW` (409 w complete, wizyta „Nie przyszedł”) — `@/lib/no-show`
//   (`NO_SHOW_COMPLETE_BLOCKED_CODE`); PUT i DELETE odpowiadają przy tym statusie
//   400 `NO_SHOW_DEDICATED_ROUTE` (najpierw cofnięcie oznaczenia), też z `@/lib/no-show`.
// Moduł bez importów serwerowych.

/**
 * - `appointmentNotFound` — 404: brak wizyty w salonie z sesji (albo pracownik
 *   pyta o cudzą wizytę; odpowiedź nie zdradza, że wizyta istnieje);
 * - `invalidId` — 400: identyfikator wizyty nie jest UUID (przed odczytem wizyty);
 * - `salonNotFound` — 404: sesja bez salonu;
 * - `appointmentCancelled` — 400: wizyta jest anulowana;
 * - `invalidJson` — 400: body żądania nie jest poprawnym JSON-em;
 * - `assignmentForbidden` — 403: pracownik zmienia pracownika, klienta albo
 *   usługę wizyty (zmienia je tylko właściciel albo recepcja).
 */
export const APPOINTMENT_ERROR_CODES = {
  appointmentNotFound: "APPOINTMENT_NOT_FOUND",
  invalidId: "INVALID_APPOINTMENT_ID",
  salonNotFound: "SALON_NOT_FOUND",
  appointmentCancelled: "APPOINTMENT_CANCELLED",
  invalidJson: "INVALID_JSON",
  assignmentForbidden: "APPOINTMENT_ASSIGNMENT_FORBIDDEN",
} as const;

export type AppointmentErrorKey = keyof typeof APPOINTMENT_ERROR_CODES;
export type AppointmentErrorCode = (typeof APPOINTMENT_ERROR_CODES)[AppointmentErrorKey];
export type AppointmentErrorStatus = 400 | 403 | 404;

/**
 * Status HTTP każdego wspólnego kodu wizyty — jedno źródło dla tras
 * GET/PUT/DELETE wizyty; test porównuje go ze statusem trasy zakończenia.
 */
export const APPOINTMENT_ERROR_STATUS: Record<AppointmentErrorCode, AppointmentErrorStatus> = {
  APPOINTMENT_NOT_FOUND: 404,
  INVALID_APPOINTMENT_ID: 400,
  SALON_NOT_FOUND: 404,
  APPOINTMENT_CANCELLED: 400,
  INVALID_JSON: 400,
  APPOINTMENT_ASSIGNMENT_FORBIDDEN: 403,
};

/**
 * Body i status odpowiedzi błędu wizyty dla wspólnego kodu. Bez
 * `NextResponse`, żeby moduł został bez importów serwerowych:
 * `NextResponse.json(e.body, { status: e.status })`.
 */
export function appointmentError(
  key: AppointmentErrorKey,
  message: string
): { status: AppointmentErrorStatus; body: { success: false; code: AppointmentErrorCode; error: string } } {
  const code = APPOINTMENT_ERROR_CODES[key];
  return { status: APPOINTMENT_ERROR_STATUS[code], body: { success: false, code, error: message } };
}

// Oznaczenie „Nie przyszedł” (status wizyty `no_show`) — reguły wspólne dla
// trasy /api/appointments/[id]/no-show i interfejsu panelu.
//
// Decyzję podejmuje wyłącznie serwer. Interfejs korzysta z tych samych funkcji
// tylko po to, żeby nie pokazywać przycisku, który i tak skończyłby się 400/403.
// Moduł bez importów serwerowych: czytają go komponenty klienckie.
import type { SalonRole } from "@/lib/salon-context";

/** Status wizyty, której klient nie odwiedził. */
export const NO_SHOW_STATUS = "no_show";

/** Nazwa statusu w panelu (kalendarz, legenda, szczegóły, historia klienta). */
export const NO_SHOW_LABEL = "Nie przyszedł";

/** Role, które oznaczają i cofają „Nie przyszedł”. Pracownik (`employee`) nie. */
export const NO_SHOW_MARK_ROLES: readonly SalonRole[] = ["owner", "receptionist"];

/**
 * Statusy, z których wizytę można oznaczyć jako „Nie przyszedł”. Wizyta
 * zakończona albo anulowana ma już ostateczny wynik.
 */
export const NO_SHOW_MARKABLE_STATUSES: readonly string[] = ["scheduled", "confirmed"];

/**
 * Status po cofnięciu oznaczenia. Poprzedni status (zaplanowana/potwierdzona)
 * nie jest zapisywany, więc wizyta wraca do zaplanowanej — salon może ją dalej
 * zakończyć albo anulować jak zwykle.
 */
export const NO_SHOW_RESTORED_STATUS = "scheduled";

/** Kod 400 z PUT /api/appointments/[id], gdy ktoś próbuje zmienić „Nie przyszedł” poza trasą oznaczenia. */
export const NO_SHOW_DEDICATED_ROUTE_CODE = "NO_SHOW_DEDICATED_ROUTE";

/**
 * Kod 409 z POST /api/appointments/[id]/complete dla wizyty „Nie przyszedł”.
 * Nieobecność nie może być naraz zrealizowaną usługą (przychód, prowizja,
 * zużycie materiałów) — najpierw cofnięcie oznaczenia.
 */
export const NO_SHOW_COMPLETE_BLOCKED_CODE = "APPOINTMENT_NO_SHOW";
export const NO_SHOW_COMPLETE_BLOCKED_MESSAGE =
  "Wizyta oznaczona jako »Nie przyszedł«. Najpierw cofnij oznaczenie.";

/**
 * Statusy HTTP, przy których toast pokazuje komunikat z serwera: to opisy
 * stanu wizyty pisane dla salonu (zły status, dzień wizyty, brak wizyty,
 * konflikt z zakończeniem). Przy pozostałych (401 z warstwy sesji, 403, 500,
 * odpowiedź z proxy) treść bywa techniczna, więc toast ma stały tekst.
 */
const NO_SHOW_SERVER_MESSAGE_STATUSES: readonly number[] = [400, 404, 409];

const NO_SHOW_FIXED_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  401: "Sesja wygasła. Zaloguj się ponownie.",
  403: "Brak uprawnień",
};

/** Tekst toastu po nieudanej zmianie oznaczenia „Nie przyszedł”. */
export function noShowErrorToastMessage(
  httpStatus: number,
  serverError: unknown,
  fallback: string
): string {
  if (
    NO_SHOW_SERVER_MESSAGE_STATUSES.includes(httpStatus) &&
    typeof serverError === "string" &&
    serverError.trim() !== ""
  ) {
    return serverError;
  }
  return NO_SHOW_FIXED_ERROR_MESSAGES[httpStatus] ?? fallback;
}

/**
 * Produkt działa tylko w Polsce (PLN, SMSAPI), a godziny wizyt panel buduje
 * w czasie lokalnym — dzień wizyty liczymy w strefie salonu, nie serwera (UTC).
 */
const SALON_TIME_ZONE = "Europe/Warsaw";

const salonDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SALON_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dzień kalendarzowy w strefie salonu jako `YYYY-MM-DD` (porównywalny jako napis). */
export function salonDayKey(date: Date): string {
  return salonDayFormatter.format(date);
}

/**
 * Czy dzień wizyty już nadszedł: wizyta miniona albo dzisiejsza (cały dzisiejszy
 * dzień w strefie salonu, bez sprawdzania godziny — recepcja oznacza nieobecność
 * zwykle przy zamykaniu dnia). Wizyta jutrzejsza i późniejsza — nie.
 */
export function hasNoShowDayArrived(startTime: Date | string, now: Date = new Date()): boolean {
  const start = startTime instanceof Date ? startTime : new Date(startTime);
  if (Number.isNaN(start.getTime())) return false;
  return salonDayKey(start) <= salonDayKey(now);
}

export function isNoShowMarkRole(role: SalonRole): boolean {
  return NO_SHOW_MARK_ROLES.includes(role);
}

/** Podpowiedź dla interfejsu: czy pokazać „Nie przyszedł”. */
export function canMarkNoShow(
  input: { role: SalonRole; status: string; startTime: Date | string },
  now: Date = new Date()
): boolean {
  return (
    isNoShowMarkRole(input.role) &&
    NO_SHOW_MARKABLE_STATUSES.includes(input.status) &&
    hasNoShowDayArrived(input.startTime, now)
  );
}

/** Podpowiedź dla interfejsu: czy pokazać „Cofnij «Nie przyszedł»”. */
export function canUndoNoShow(input: { role: SalonRole; status: string }): boolean {
  return isNoShowMarkRole(input.role) && input.status === NO_SHOW_STATUS;
}

/**
 * Jedna definicja kolizji terminów (#165): przedział PÓŁOTWARTY `[start, end)`.
 *
 * Dwa przedziały kolidują wtedy i tylko wtedy, gdy `aStart < bEnd && aEnd > bStart`.
 * Styk (10:00–11:00 i 11:00–12:00) NIE jest kolizją. Wcześniej POST/PUT
 * /api/appointments i pakiet liczyły kolizję włącznie (`<=`/`>=`), a zadatek
 * i sloty półotwarcie — ta sama godzina była wolna w kreatorze i zajęta w panelu.
 *
 * Co blokuje termin: każda wizyta pracownika w statusie innym niż `cancelled`
 * (scheduled, confirmed, completed, no_show — także wizyta z zadatkiem w toku).
 *
 * Kolizje wizyt liczy się WYŁĄCZNIE przez ten moduł (strażnik:
 * `__tests__/lint/appointment-overlap-guard.test.ts`).
 */
import { and, eq, gt, lt, not, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { appointments } from "@/lib/schema";

type Instant = Date | number;

const toMs = (v: Instant): number => (typeof v === "number" ? v : v.getTime());

/**
 * Kolizja dwóch przedziałów półotwartych `[aStart, aEnd)` i `[bStart, bEnd)`.
 * Celowo bez wyjątku przy `end <= start`: available-slots przycina blokady do
 * dnia i bywa `[0, 0)` — taki przedział na krawędzi dnia nie koliduje, a pusty
 * przedział wewnątrz innego wzór uznaje za kolizję (ostrożnie: slot zablokowany).
 * Termin, który ma zostać ZAPISANY, sprawdzają `overlapsRange` /
 * `appointmentConflictWhere`, które przedział pusty odrzucają.
 */
export function rangesOverlap(aStart: Instant, aEnd: Instant, bStart: Instant, bEnd: Instant): boolean {
  return toMs(aStart) < toMs(bEnd) && toMs(aEnd) > toMs(bStart);
}

/**
 * Obrona w głębi: przy `end <= start` (albo nieprawidłowej dacie) warunek
 * półotwarty nigdy nie trafia, więc taki termin ominąłby sprawdzenie kolizji.
 * Trasy odrzucają go wcześniej z 400; tu błąd programisty, nie wejście.
 */
export function assertValidRange(start: Date, end: Date): void {
  if (!(end.getTime() > start.getTime())) {
    throw new RangeError("appointment-overlap: przedział pusty lub odwrócony (end <= start)");
  }
}

/**
 * Predykat SQL: wiersz `[startCol, endCol)` koliduje z `[start, end)`.
 * Dla wizyt i blokad czasu (urlop, przerwa). Rzuca `RangeError` przy `end <= start`.
 */
export function overlapsRange(startCol: AnyPgColumn, endCol: AnyPgColumn, start: Date, end: Date): SQL {
  assertValidRange(start, end);
  return and(lt(startCol, end), gt(endCol, start)) as SQL;
}

export interface AppointmentConflictParams {
  /** Filtr aplikacyjny salonu (defense in depth obok RLS); pomijany na ścieżkach publicznych. */
  salonId?: string;
  employeeId: string;
  start: Date;
  end: Date;
  /** Wizyta, która nie koliduje sama ze sobą (edycja, przeniesienie). */
  excludeId?: string | null;
}

/**
 * Warunek WHERE na `appointments`: wizyty, które blokują termin `[start, end)` pracownika.
 * Rzuca `RangeError` przy `end <= start` (przez `overlapsRange`).
 */
export function appointmentConflictWhere(params: AppointmentConflictParams): SQL {
  const conditions: SQL[] = [eq(appointments.employeeId, params.employeeId)];
  if (params.salonId) conditions.push(eq(appointments.salonId, params.salonId));
  if (params.excludeId) conditions.push(not(eq(appointments.id, params.excludeId)));
  conditions.push(not(eq(appointments.status, "cancelled")));
  conditions.push(overlapsRange(appointments.startTime, appointments.endTime, params.start, params.end));
  return and(...conditions) as SQL;
}

/**
 * Nazwa ograniczenia `EXCLUDE` w bazie (migracja 0009, #171): ta sama reguła
 * co `appointmentConflictWhere` (pracownik, `[start, end)`, bez `cancelled`).
 * Łapie wyścig, którego SELECT przed INSERT nie złapie — dwa równoległe zapisy
 * tego samego terminu.
 */
export const APPOINTMENT_NO_OVERLAP_CONSTRAINT = "appointments_no_overlap";

/** SQLSTATE `exclusion_violation`. */
const EXCLUSION_VIOLATION = "23P01";
/** SQLSTATE `deadlock_detected`. */
const DEADLOCK_DETECTED = "40P01";

type PgErrorShape = {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  where?: unknown;
  cause?: unknown;
};

/**
 * Pierwszy obiekt z polem `code` w łańcuchu `cause` (Drizzle opakowuje błąd
 * sterownika w `DrizzleQueryError`). Najwyżej 5 poziomów — cykl się nie zapętli.
 */
function driverError(error: unknown): PgErrorShape | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as PgErrorShape;
    if (typeof e.code === "string") return e;
    current = e.cause;
  }
  return undefined;
}

/** SQLSTATE błędu bazy (do logów przy 500), `undefined` dla błędów spoza bazy. */
export function dbErrorCode(error: unknown): string | undefined {
  return driverError(error)?.code as string | undefined;
}

/**
 * Czy błąd zapisu wizyty oznacza „termin zajęty” (→ 409 w trasie):
 *
 * - 23P01 na `appointments_no_overlap` (#171) — równoległy zapis zajął termin.
 *   postgres.js podaje nazwę w `constraint_name`, node-postgres w `constraint`.
 * - 40P01 (zakleszczenie) przy SPRAWDZANIU tego ograniczenia: dwie transakcje
 *   przenoszą wizyty „na krzyż” i każda czeka na wynik drugiej (main `db71a43`,
 *   QG 43818105194). Baza wycofuje jedną — dla klienta to ta sama kolizja.
 *   Rozpoznanie po CONTEXT (pole `where` w postgres.js i node-postgres):
 *   „while checking exclusion constraint on tuple … in relation "appointments"”.
 *   40P01 nie ma nazwy ograniczenia. Cloud SQL i Neon zwracają komunikaty po
 *   angielsku; przy innym `lc_messages` wzorzec nie pasuje i trasa zwraca 500
 *   (jak przed poprawką) — test pg na prawdziwym zakleszczeniu to wychwyci.
 *
 * Wszystko inne to 500: inne zakleszczenia (zadatek, subskrypcje mają własne
 * blokady), 40001, CHECK `appointments_end_after_start` (23514). Bez ponawiania.
 */
export function isAppointmentSlotTaken(error: unknown): boolean {
  const e = driverError(error);
  if (!e) return false;
  if (e.code === EXCLUSION_VIOLATION) {
    return (e.constraint_name ?? e.constraint) === APPOINTMENT_NO_OVERLAP_CONSTRAINT;
  }
  if (e.code === DEADLOCK_DETECTED) {
    return (
      typeof e.where === "string" &&
      e.where.includes("exclusion constraint") &&
      e.where.includes('relation "appointments"')
    );
  }
  return false;
}

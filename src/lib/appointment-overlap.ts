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

/** Kolizja dwóch przedziałów półotwartych `[aStart, aEnd)` i `[bStart, bEnd)`. */
export function rangesOverlap(aStart: Instant, aEnd: Instant, bStart: Instant, bEnd: Instant): boolean {
  return toMs(aStart) < toMs(bEnd) && toMs(aEnd) > toMs(bStart);
}

/**
 * Predykat SQL: wiersz `[startCol, endCol)` koliduje z `[start, end)`.
 * Dla wizyt i blokad czasu (urlop, przerwa).
 */
export function overlapsRange(startCol: AnyPgColumn, endCol: AnyPgColumn, start: Date, end: Date): SQL {
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

/** Warunek WHERE na `appointments`: wizyty, które blokują termin `[start, end)` pracownika. */
export function appointmentConflictWhere(params: AppointmentConflictParams): SQL {
  const conditions: SQL[] = [eq(appointments.employeeId, params.employeeId)];
  if (params.salonId) conditions.push(eq(appointments.salonId, params.salonId));
  if (params.excludeId) conditions.push(not(eq(appointments.id, params.excludeId)));
  conditions.push(not(eq(appointments.status, "cancelled")));
  conditions.push(overlapsRange(appointments.startTime, appointments.endTime, params.start, params.end));
  return and(...conditions) as SQL;
}

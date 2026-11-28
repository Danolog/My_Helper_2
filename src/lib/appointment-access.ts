/**
 * Warunek „wizyta wołającego” dla odczytu (GET), zapisu i odwołania wizyty
 * w panelu salonu.
 *
 * Właściciel i recepcja działają na każdej wizycie salonu z sesji. Każda inna
 * rola (dziś `employee`) tylko na wizycie przypisanej do własnego rekordu
 * pracownika. Przy błędzie warunek zamyka dostęp: rola spoza listy pełnego
 * dostępu bez identyfikatora pracownika nie dostaje żadnej wizyty, a nie
 * warunku właściciela.
 *
 * Cudza wizyta i wizyta nieistniejąca dają tę samą odpowiedź 404, więc
 * odmowa nie zdradza, że wizyta istnieje.
 *
 * Ta sama lista ról decyduje, kto zmienia pracownika, klienta i usługę
 * wizyty (`hasFullAppointmentAccess`).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { SalonContext, SalonRole } from "@/lib/salon-context";
import { appointments } from "@/lib/schema";

/** Część kontekstu salonu, od której zależy warunek. */
export type AppointmentCaller = Pick<SalonContext, "role" | "employeeId">;

/** Role, które działają na każdej wizycie salonu. */
const FULL_ACCESS_ROLES: readonly SalonRole[] = ["owner", "receptionist"];

/**
 * Czy wołający działa na każdej wizycie salonu (właściciel, recepcja).
 * Tylko te role zmieniają pracownika, klienta i usługę wizyty: usługa
 * wyznacza cenę, a cena prowizję.
 */
export function hasFullAppointmentAccess(caller: Pick<AppointmentCaller, "role">): boolean {
  return FULL_ACCESS_ROLES.includes(caller.role);
}

/**
 * Identyfikator pracownika, do którego wizyt ogranicza się wołający, albo
 * `null`, gdy wołający działa na każdej wizycie salonu. Pusty tekst oznacza
 * „żadna wizyta” (rola ograniczona bez identyfikatora pracownika).
 */
function restrictedEmployeeId(caller: AppointmentCaller): string | null {
  if (FULL_ACCESS_ROLES.includes(caller.role)) return null;
  return caller.employeeId || "";
}

/** Czy wizyta przypisana do `appointmentEmployeeId` jest dla wołającego cudza. */
export function isForeignAppointment(
  caller: AppointmentCaller,
  appointmentEmployeeId: string | null
): boolean {
  const only = restrictedEmployeeId(caller);
  if (only === null) return false;
  return only === "" || appointmentEmployeeId !== only;
}

/**
 * Warunek SQL wiersza wizyty wołającego w salonie `salonId`. Rola ograniczona
 * bez identyfikatora pracownika dostaje warunek bez trafień.
 */
export function callerAppointmentWhere(
  caller: AppointmentCaller,
  salonId: string,
  appointmentId: string
): SQL {
  const base = and(eq(appointments.id, appointmentId), eq(appointments.salonId, salonId))!;
  const only = restrictedEmployeeId(caller);
  if (only === null) return base;
  if (only === "") return and(base, sql`false`)!;
  return and(base, eq(appointments.employeeId, only))!;
}

/**
 * Wizyty nie ma dla wołającego w chwili zapisu: usunięta albo przepisana na
 * innego pracownika (stan spod blokady wiersza albo warunek w UPDATE).
 * Rzucany w transakcji, żeby wycofać wszystkie jej zapisy; trasa mapuje go
 * na 404 `APPOINTMENT_NOT_FOUND`, tę samą odpowiedź co dla wizyty nieistniejącej.
 */
export class AppointmentGoneError extends Error {
  constructor() {
    super("Appointment not found at write");
    this.name = "AppointmentGoneError";
  }
}

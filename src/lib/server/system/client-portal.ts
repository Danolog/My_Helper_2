/**
 * Wyjście systemowe (#193, ADR-002 wariant U): odczyty portalu klienta.
 *
 * Dlaczego pula systemowa, a nie `forSalon`: w portalu zakres to jeden
 * użytkownik w wielu salonach, więc nie ma jednego salonu, na który dałoby się
 * ustawić kontekst RLS przed odczytem. Funkcje `find…ForUser` zwracają
 * `salonId`, a zapis do wiersza salonu idzie potem przez `forSalon(salonId)`
 * z ponowionym warunkiem tożsamości i stanu.
 *
 * Zasady modułu:
 * - tylko odczyt, bez żadnej funkcji zapisującej;
 * - pierwszy argument to tożsamość z sesji (`authResult.user.id`), nigdy
 *   wartość z body, query ani nagłówka; pusta wartość = wyjątek;
 * - warunek tożsamości siedzi w funkcji, nie u wołającego;
 * - jawna lista kolumn; wewnętrzne id w DTO służą tylko decyzji trasy
 *   i nie trafiają do odpowiedzi.
 *
 * Błąd bazy propaguje do wołającego.
 */
import { and, eq } from "drizzle-orm";
import { appointments, employees, salons, services } from "@/lib/schema";
import { dbSystem } from "./db-system";

function requireSessionUser(sessionUserId: string): void {
  if (!sessionUserId) {
    throw new Error("client-portal: sessionUserId wymagany");
  }
}

/** Wizyta klienta do decyzji o anulowaniu (podgląd i zapis). */
export type ClientAppointmentForCancel = {
  appointmentId: string;
  salonId: string;
  serviceId: string | null;
  employeeId: string | null;
  status: string;
  startTime: Date;
  endTime: Date;
  depositAmount: string | null;
  depositPaid: boolean;
  salonName: string | null;
  salonPhone: string | null;
  serviceName: string | null;
  servicePrice: string | null;
  employeeName: string | null;
};

/**
 * Wizyta zarezerwowana przez konto `sessionUserId` albo null (brak wizyty,
 * wizyta innego konta albo dodana przez personel — bez rozróżnienia).
 */
export async function findClientAppointmentForUser(
  sessionUserId: string,
  appointmentId: string,
): Promise<ClientAppointmentForCancel | null> {
  requireSessionUser(sessionUserId);

  const [row] = await dbSystem
    .select({
      appointmentId: appointments.id,
      salonId: appointments.salonId,
      serviceId: appointments.serviceId,
      employeeId: appointments.employeeId,
      status: appointments.status,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      depositAmount: appointments.depositAmount,
      depositPaid: appointments.depositPaid,
      salonName: salons.name,
      salonPhone: salons.phone,
      serviceName: services.name,
      servicePrice: services.basePrice,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
    })
    .from(appointments)
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(salons, eq(appointments.salonId, salons.id))
    .where(and(eq(appointments.id, appointmentId)))
    .limit(1);

  if (!row) return null;

  return {
    appointmentId: row.appointmentId,
    salonId: row.salonId,
    serviceId: row.serviceId,
    employeeId: row.employeeId,
    status: row.status,
    startTime: row.startTime,
    endTime: row.endTime,
    depositAmount: row.depositAmount,
    depositPaid: row.depositPaid === true,
    salonName: row.salonName ?? null,
    salonPhone: row.salonPhone ?? null,
    serviceName: row.serviceName ?? null,
    servicePrice: row.servicePrice ?? null,
    // Pracownik z łączenia: imię i nazwisko są NOT NULL, więc null = brak pracownika.
    employeeName:
      row.employeeFirstName !== null && row.employeeLastName !== null
        ? `${row.employeeFirstName} ${row.employeeLastName}`
        : null,
  };
}

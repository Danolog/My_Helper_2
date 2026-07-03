import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees, salons } from "@/lib/schema";
import { hasTemporaryAccess } from "@/lib/temporary-access";

/**
 * Kontekst salonu zalogowanego użytkownika (Faza 3 — role pracownik/recepcja).
 *
 * Rozszerza wzorzec get-user-salon.ts: oprócz właściciela (salons.ownerId)
 * rozpoznaje też AKTYWNEGO pracownika podpiętego kontem (employees.userId).
 * Surowe `db` jest tu OK — lib poza src/app/api (jak get-user-salon.ts);
 * trasy API nadal używają forSalon(ctx.salonId) do dostępu do danych.
 */

export type SalonRole = "owner" | "receptionist" | "employee";

export interface SalonContext {
  salonId: string;
  role: SalonRole;
  /** Rekord employees powiązany z kontem (null, gdy właściciel bez własnego rekordu). */
  employeeId: string | null;
  userId: string;
}

/**
 * Ustala kontekst salonu dla zalogowanego użytkownika:
 * 1. salon właścicielski (salons.ownerId === user.id) => role "owner"
 *    (employeeId = własny rekord employees w tym salonie, jeśli istnieje),
 * 2. inaczej aktywny pracownik (employees.userId === user.id AND isActive)
 *    => salonId z rekordu, role z employees.role ("receptionist" | "employee"),
 * 3. brak obu => null.
 */
export async function getSalonContext(): Promise<SalonContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const userId = session.user.id;

  // 1. Salon właścicielski
  const [salon] = await db
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, userId))
    .limit(1);

  if (salon) {
    const [ownEmployee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, userId), eq(employees.salonId, salon.id)))
      .limit(1);

    return {
      salonId: salon.id,
      role: "owner",
      employeeId: ownEmployee?.id ?? null,
      userId,
    };
  }

  // 2. Aktywny pracownik podpięty kontem (nieaktywny NIE dostaje kontekstu)
  const [employee] = await db
    .select({
      id: employees.id,
      salonId: employees.salonId,
      role: employees.role,
    })
    .from(employees)
    .where(and(eq(employees.userId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) return null;

  return {
    salonId: employee.salonId,
    // "owner" w employees.role to etykieta wizytówkowa — uprawnienia właściciela
    // daje wyłącznie salons.ownerId (gałąź 1), więc tu mapujemy na "employee".
    // "reception" to historyczna wartość zapisywana przez starszy formularz UI
    role:
      employee.role === "receptionist" || employee.role === "reception"
        ? "receptionist"
        : "employee",
    employeeId: employee.id,
    userId,
  };
}

/**
 * Czy użytkownik w danym kontekście ma dostęp do funkcji `feature`?
 * Właściciel: zawsze. Pracownik/recepcja: tylko z aktywnym grantem
 * temporary_access (Feature #25, hasTemporaryAccess sprawdza wygaśnięcie).
 */
export async function hasFeatureAccess(
  ctx: SalonContext,
  feature: string
): Promise<boolean> {
  if (ctx.role === "owner") return true;
  return hasTemporaryAccess(ctx.userId, feature);
}

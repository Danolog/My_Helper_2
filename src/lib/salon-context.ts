import { headers } from "next/headers";
import { NextResponse } from "next/server";
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

  return resolveSalonContext(session.user.id);
}

/** Rdzeń getSalonContext dla znanego userId (bez ponownego pobierania sesji). */
async function resolveSalonContext(userId: string): Promise<SalonContext | null> {

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
 * temporary_access nadanym przez właściciela salonu z kontekstu (grant z innego
 * salonu się nie liczy; hasTemporaryAccess sprawdza też wygaśnięcie).
 */
export async function hasFeatureAccess(
  ctx: SalonContext,
  feature: string
): Promise<boolean> {
  if (ctx.role === "owner") return true;
  return hasTemporaryAccess(ctx.userId, feature, ctx.salonId);
}

export interface SalonStaffOptions {
  /**
   * Role salonu dopuszczone BEZ grantu. Właściciel (salons.ownerId) przechodzi
   * zawsze. Brak `roles` i brak `feature` => każdy członek personelu salonu;
   * brak `roles` przy podanym `feature` => tylko właściciel albo grant.
   */
  roles?: readonly SalonRole[];
  /** Czasowy grant temporary_access, który otwiera dostęp roli spoza `roles`. */
  feature?: string;
  /**
   * salonId podany przez żądanie (query/body). NIGDY nie wybiera salonu —
   * jest wyłącznie porównywany z salonem sesji: inny => 403. Pusty => salon sesji.
   */
  requestedSalonId?: string | null;
}

export type SalonStaffResult =
  | { ctx: SalonContext; error?: undefined }
  | { ctx?: undefined; error: NextResponse };

function deny(status: 401 | 403 | 404, error: string): SalonStaffResult {
  return { error: NextResponse.json({ success: false, error }, { status }) };
}

/**
 * Bramka tras salon-scoped: salon WYŁĄCZNIE z sesji (getSalonContext), nie z
 * żądania. RLS (forSalon) porównuje salon_id z tym, co mu podamy — jeśli podamy
 * salonId z query/body, nie chroni przed niczym. Ta funkcja jest źródłem
 * salonId dla forSalon(ctx.salonId).
 *
 * Statusy: brak sesji 401; konto bez salonu 404; salonId z żądania inny niż
 * salon sesji 403; rola spoza `roles` bez grantu `feature` 403.
 *
 * Uprawnień NIE bierze z user.role (na produkcji rola "owner" jest tylko na
 * części kont właścicieli) — własność = salons.ownerId, rola = employees.role.
 */
export async function requireSalonStaff(
  options: SalonStaffOptions = {}
): Promise<SalonStaffResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return deny(401, "Wymagane logowanie");

  const ctx = await resolveSalonContext(session.user.id);
  if (!ctx) return deny(404, "Salon not found");

  const { roles, feature, requestedSalonId } = options;
  if (requestedSalonId && requestedSalonId !== ctx.salonId) {
    return deny(403, "Brak dostepu do tego salonu");
  }

  if (ctx.role === "owner") return { ctx };

  const allowedRoles: readonly SalonRole[] =
    roles ?? (feature ? [] : ["receptionist", "employee"]);
  if (allowedRoles.includes(ctx.role)) return { ctx };
  // Grant liczy się tylko w salonie, w którym nadał go jego właściciel.
  if (feature && (await hasTemporaryAccess(ctx.userId, feature, ctx.salonId))) {
    return { ctx };
  }

  return deny(403, "Brak uprawnien");
}

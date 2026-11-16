/**
 * Wyjście systemowe (#193): ustalanie salonu dla zalogowanego użytkownika.
 *
 * Te zapytania poprzedzają `forSalon` — trzeba najpierw wiedzieć, KTÓRY salon
 * jest kontekstem żądania — więc idą przez pulę systemową, nie przez
 * `forSalon`. Wejście: wyłącznie `userId` z sesji (i `salonId` z kontekstu
 * sesji), NIGDY z żądania. Moduły w `src/lib` (salon-context, get-user-salon,
 * temporary-access, session) delegują tutaj; ich API się nie zmienia.
 */
import { and, eq, gt } from "drizzle-orm";
import { employees, salons, temporaryAccess } from "@/lib/schema";
import { dbSystem } from "./db-system";

export type SalonRole = "owner" | "receptionist" | "employee";

export interface SalonContext {
  salonId: string;
  role: SalonRole;
  /** Rekord employees powiązany z kontem (null, gdy właściciel bez własnego rekordu). */
  employeeId: string | null;
  userId: string;
}

export type SalonContextResolution =
  | { ctx: SalonContext; reason?: undefined }
  | { ctx: null; reason: "none" | "ambiguous" };

/**
 * Kontekst salonu dla znanego userId (rdzeń getSalonContext).
 *
 * Pracownik: pobieramy do 2 aktywnych rekordów. Więcej niż jeden = naruszenie
 * niezmiennika „konto -> najwyżej jeden pracownik" (link-account go pilnuje,
 * ale bez UNIQUE w bazie) => reason "ambiguous", brak kontekstu. Odmowa jest
 * bezpieczniejsza niż orderBy: każda kolejność wybiera salon za użytkownika
 * i może po cichu otworzyć dane salonu, z którym konto nie powinno już
 * pracować (np. stary rekord, którego nikt nie dezaktywował).
 */
export async function resolveSalonContext(userId: string): Promise<SalonContextResolution> {
  // 1. Salon właścicielski
  const [salon] = await dbSystem
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, userId))
    .limit(1);

  if (salon) {
    const [ownEmployee] = await dbSystem
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, userId), eq(employees.salonId, salon.id)))
      .limit(1);

    return {
      ctx: {
        salonId: salon.id,
        role: "owner",
        employeeId: ownEmployee?.id ?? null,
        userId,
      },
    };
  }

  // 2. Aktywny pracownik podpięty kontem (nieaktywny NIE dostaje kontekstu)
  const activeRecords = await dbSystem
    .select({
      id: employees.id,
      salonId: employees.salonId,
      role: employees.role,
    })
    .from(employees)
    .where(and(eq(employees.userId, userId), eq(employees.isActive, true)))
    .limit(2);

  if (activeRecords.length > 1) return { ctx: null, reason: "ambiguous" };
  const [employee] = activeRecords;
  if (!employee) return { ctx: null, reason: "none" };

  return {
    ctx: {
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
    },
  };
}

/** Salon, którego właścicielem jest `userId` (wiersz salonu) albo null. */
export async function getUserSalon(userId: string) {
  const [salon] = await dbSystem
    .select()
    .from(salons)
    .where(eq(salons.ownerId, userId))
    .limit(1);

  return salon ?? null;
}

/** Id salonu, którego właścicielem jest `userId`, albo null. */
export async function getUserSalonId(userId: string): Promise<string | null> {
  const salon = await getUserSalon(userId);
  return salon?.id ?? null;
}

/**
 * Czy `userId` jest właścicielem jakiegoś salonu (requireAdmin).
 * Błąd bazy propaguje — bez cichego `false`.
 */
export async function isSalonOwner(userId: string): Promise<boolean> {
  const [salon] = await dbSystem
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, userId))
    .limit(1);

  return !!salon;
}

/**
 * Czy użytkownik ma aktywny (niewygasły) czasowy dostęp do funkcji W DANYM SALONIE?
 *
 * Grant jest uznawany tylko, gdy nadał go właściciel salonu z kontekstu sesji
 * (temporary_access.granted_by = salons.owner_id AND salons.id = salonId).
 * Bez tego grant nadany w salonie A otwierał funkcję w salonie B, jeśli konto
 * pracuje (lub zostało przepięte) do innego salonu.
 *
 * Tabela nie ma kolumny salon_id — zawężenie po granted_by to rozwiązanie
 * przejściowe; docelowo kolumna salon_id (migracja, osobne zadanie).
 *
 * @param userId - konto, dla którego sprawdzamy grant
 * @param featureName - nazwa funkcji
 * @param salonId - salon z kontekstu sesji (NIGDY z żądania)
 */
export async function hasTemporaryAccess(
  userId: string,
  featureName: string,
  salonId: string
): Promise<boolean> {
  const now = new Date();

  const [grant] = await dbSystem
    .select({ id: temporaryAccess.id })
    .from(temporaryAccess)
    .innerJoin(salons, eq(salons.ownerId, temporaryAccess.grantedBy))
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(temporaryAccess.featureName, featureName),
        eq(salons.id, salonId),
        gt(temporaryAccess.expiresAt, now)
      )
    )
    .limit(1);

  return !!grant;
}

/**
 * Aktywne granty użytkownika nadane przez właściciela salonu `salonId`
 * (to samo zawężenie co hasTemporaryAccess).
 *
 * @param userId - konto, dla którego listujemy granty
 * @param salonId - salon z kontekstu sesji
 */
export async function getActiveTemporaryAccess(userId: string, salonId: string) {
  const now = new Date();

  return dbSystem
    .select({
      id: temporaryAccess.id,
      userId: temporaryAccess.userId,
      featureName: temporaryAccess.featureName,
      grantedBy: temporaryAccess.grantedBy,
      expiresAt: temporaryAccess.expiresAt,
      createdAt: temporaryAccess.createdAt,
    })
    .from(temporaryAccess)
    .innerJoin(salons, eq(salons.ownerId, temporaryAccess.grantedBy))
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(salons.id, salonId),
        gt(temporaryAccess.expiresAt, now)
      )
    );
}

/**
 * Kasuje granty konta `userId` nadane przez właściciela `grantedBy` — czyli
 * granty JEDNEGO salonu (tego, którego właścicielem jest grantedBy). Wołane
 * przy odpięciu konta od pracownika, żeby grant nie „ożył" po ponownym
 * podpięciu. Granty z innych salonów zostają nietknięte.
 *
 * @returns liczba skasowanych grantów
 */
export async function revokeSalonGrantsForUser(
  userId: string,
  grantedBy: string
): Promise<number> {
  const revoked = await dbSystem
    .delete(temporaryAccess)
    .where(
      and(
        eq(temporaryAccess.userId, userId),
        eq(temporaryAccess.grantedBy, grantedBy)
      )
    )
    .returning({ id: temporaryAccess.id });

  return revoked.length;
}

/**
 * Wyjście systemowe (#193): dostęp kont do salonu jako personel.
 *
 * 1. Sprawdzenie konta przed podpięciem go do pracownika
 *    (`PUT /api/employees/[id]/link-account`).
 *
 *    Dlaczego pula systemowa, a nie `forSalon`: konto szukamy w tabeli Better Auth
 *    `user` (bez `salon_id`), a reguły „konto podpięte do najwyżej jednego
 *    pracownika” i „właściciel salonu nie jest pracownikiem” obejmują z definicji
 *    WSZYSTKIE salony.
 *
 *    Co zwraca: id konta, flagę potwierdzenia e-maila i dwie flagi — bez id ani
 *    danych innych salonów czy pracowników. `email` pochodzi z treści żądania
 *    właściciela; `exceptEmployeeId` to pracownik już sprawdzony w salonie
 *    wołającego (`forSalon(salonId).findOne`).
 *
 * 2. Granty czasowego dostępu salonu (`/api/temporary-access`): lista, nadanie
 *    (przedłużenie albo nowy grant) i cofnięcie.
 *
 *    Dlaczego pula systemowa: tabela `temporary_access` nie ma `salon_id`, więc
 *    RLS jej nie chroni. Grant należy do salonu, którego właściciel go nadał
 *    (`granted_by`). Każde zapytanie ma warunek `granted_by = ownerUserId`;
 *    `ownerUserId` to właściciel salonu z kontekstu sesji (salons.ownerId),
 *    NIGDY wartość z żądania. Pusty `ownerUserId` = wyjątek (fail-fast).
 *
 * Błąd bazy propaguje do wołającego.
 */
import { and, eq, gt, ne } from "drizzle-orm";
import { employees, salons, temporaryAccess, user } from "@/lib/schema";
import { dbSystem } from "./db-system";

/** Wiersz grantu czasowego dostępu. */
export type TemporaryAccessGrant = typeof temporaryAccess.$inferSelect;

/** Wynik nadania: grant po zapisie i czy przedłużono istniejący aktywny grant. */
export type TemporaryAccessGrantResult = {
  grant: TemporaryAccessGrant | null;
  extended: boolean;
};

function requireOwner(ownerUserId: string): void {
  if (!ownerUserId) {
    throw new Error("staff-access: ownerUserId wymagany");
  }
}

export type EmployeeLinkAccount = {
  id: string;
  emailVerified: boolean;
  /** Konto podpięte do innego pracownika (w dowolnym salonie) niż `exceptEmployeeId`. */
  linkedElsewhere: boolean;
  /** Konto jest właścicielem jakiegoś salonu. */
  ownsSalon: boolean;
};

/** Konto o podanym e-mailu z flagami do podpięcia pod pracownika albo null (brak konta). */
export async function findAccountForEmployeeLink(
  email: string,
  exceptEmployeeId: string,
): Promise<EmployeeLinkAccount | null> {
  const [account] = await dbSystem
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!account) return null;

  const [alreadyLinked] = await dbSystem
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.userId, account.id), ne(employees.id, exceptEmployeeId)))
    .limit(1);

  const [ownedSalon] = await dbSystem
    .select({ id: salons.id })
    .from(salons)
    .where(eq(salons.ownerId, account.id))
    .limit(1);

  return {
    id: account.id,
    emailVerified: account.emailVerified === true,
    linkedElsewhere: alreadyLinked !== undefined,
    ownsSalon: ownedSalon !== undefined,
  };
}

/**
 * Aktywne (niewygasłe) granty nadane przez właściciela `ownerUserId`;
 * `filter.userId` zawęża dalej do jednego konta, nigdy nie wychodzi poza salon.
 */
export async function listSalonGrants(
  ownerUserId: string,
  filter: { userId?: string | undefined },
): Promise<TemporaryAccessGrant[]> {
  requireOwner(ownerUserId);
  const now = new Date();

  return dbSystem
    .select()
    .from(temporaryAccess)
    .where(
      and(
        eq(temporaryAccess.grantedBy, ownerUserId),
        ...(filter.userId ? [eq(temporaryAccess.userId, filter.userId)] : []),
        gt(temporaryAccess.expiresAt, now),
      ),
    );
}

/**
 * Nadaje kontu `grant.userId` czasowy dostęp do funkcji w salonie właściciela
 * `ownerUserId`. Jeśli ten sam właściciel ma już aktywny grant na to samo konto
 * i funkcję — przedłuża go (`extended: true`); inaczej wstawia nowy.
 * Grant nadany przez właściciela innego salonu nie jest ani przedłużany, ani
 * przejmowany. Wołający sprawdza wcześniej, że konto jest pracownikiem salonu.
 */
export async function grantTemporaryAccess(
  ownerUserId: string,
  grant: { userId: string; featureName: string; expiresAt: Date },
): Promise<TemporaryAccessGrantResult> {
  requireOwner(ownerUserId);
  const now = new Date();

  const [existing] = await dbSystem
    .select({ id: temporaryAccess.id })
    .from(temporaryAccess)
    .where(
      and(
        eq(temporaryAccess.userId, grant.userId),
        eq(temporaryAccess.featureName, grant.featureName),
        eq(temporaryAccess.grantedBy, ownerUserId),
        gt(temporaryAccess.expiresAt, now),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await dbSystem
      .update(temporaryAccess)
      .set({ expiresAt: grant.expiresAt })
      .where(and(eq(temporaryAccess.id, existing.id), eq(temporaryAccess.grantedBy, ownerUserId)))
      .returning();
    return { grant: updated ?? null, extended: true };
  }

  const [created] = await dbSystem
    .insert(temporaryAccess)
    .values({
      userId: grant.userId,
      featureName: grant.featureName,
      grantedBy: ownerUserId,
      expiresAt: grant.expiresAt,
    })
    .returning();
  return { grant: created ?? null, extended: false };
}

/**
 * Cofa grant `grantId` nadany przez właściciela `ownerUserId`. Zwraca usunięty
 * grant albo null (brak grantu albo grant innego salonu — bez rozróżnienia).
 */
export async function revokeTemporaryAccess(
  ownerUserId: string,
  grantId: string,
): Promise<TemporaryAccessGrant | null> {
  requireOwner(ownerUserId);

  const [deleted] = await dbSystem
    .delete(temporaryAccess)
    .where(and(eq(temporaryAccess.id, grantId), eq(temporaryAccess.grantedBy, ownerUserId)))
    .returning();

  return deleted ?? null;
}

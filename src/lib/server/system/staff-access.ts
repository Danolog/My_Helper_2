/**
 * Wyjście systemowe (#193): dostęp kont do salonu jako personel.
 *
 * Dziś: sprawdzenie konta przed podpięciem go do pracownika
 * (`PUT /api/employees/[id]/link-account`).
 *
 * Dlaczego pula systemowa, a nie `forSalon`: konto szukamy w tabeli Better Auth
 * `user` (bez `salon_id`), a reguły „konto podpięte do najwyżej jednego
 * pracownika” i „właściciel salonu nie jest pracownikiem” obejmują z definicji
 * WSZYSTKIE salony.
 *
 * Co zwraca: id konta, flagę potwierdzenia e-maila i dwie flagi — bez id ani
 * danych innych salonów czy pracowników. `email` pochodzi z treści żądania
 * właściciela; `exceptEmployeeId` to pracownik już sprawdzony w salonie
 * wołającego (`forSalon(salonId).findOne`).
 *
 * Błąd bazy propaguje do wołającego.
 */
import { and, eq, ne } from "drizzle-orm";
import { employees, salons, user } from "@/lib/schema";
import { dbSystem } from "./db-system";

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

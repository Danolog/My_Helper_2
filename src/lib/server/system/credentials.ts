/**
 * Wyjście systemowe (#193 A2b): hash hasła konta e-mail/hasło (`account`,
 * `provider_id = 'credential'`) do potwierdzenia hasłem operacji w panelu
 * (dziś: usunięcie klienta, `DELETE /api/clients/[id]`).
 *
 * Dlaczego pula systemowa, a nie `forSalon`: `account` to tabela Better Auth
 * bez `salon_id` — dane uwierzytelniające użytkownika, nie dane salonu.
 *
 * Co czyta: wyłącznie kolumnę `password` jednego wiersza konta `credential`
 * wskazanego użytkownika (bez tokenów OAuth i pozostałych kolumn).
 * `userId` ma pochodzić z sesji wołającego, nigdy z treści żądania.
 *
 * Błąd bazy propaguje do wołającego.
 */
import { and, eq } from "drizzle-orm";
import { account } from "@/lib/schema";
import { dbSystem } from "./db-system";

/** Hash hasła konta `credential` użytkownika albo null (brak konta lub konto bez hasła). */
export async function findCredentialPasswordHash(userId: string): Promise<string | null> {
  const [row] = await dbSystem
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return row?.password ?? null;
}

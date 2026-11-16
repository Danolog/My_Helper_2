/**
 * Adapter Better Auth na puli systemowej (#193, Z9; decyzja Ethana R-Z1).
 *
 * Jawny schemat obejmuje WYŁĄCZNIE 4 tabele auth. Adapter nie sięga do żadnej
 * innej tabeli — model spoza tej listy kończy się błędem adaptera (test).
 * Skróty haseł i tokeny sesji nie są czytelne dla zapytań ścieżki żądania;
 * w P6 pula żądań traci granty na account/session/verification.
 *
 * Wyjątek od Z7/W2 z zamkniętej listy (Ethan 16.11). Importuje go wyłącznie
 * `src/lib/auth.ts` (test skanu importów); nie wychodzi przez `system/index.ts`.
 */
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "@/lib/schema";
import { dbSystem } from "./db-system";

export const authAdapter = drizzleAdapter(dbSystem, {
  provider: "pg",
  schema: { user, session, account, verification },
});

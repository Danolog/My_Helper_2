/**
 * Adapter Better Auth na puli systemowej (#193, Z9; decyzja z recenzji R-Z1).
 *
 * Jawny schemat obejmuje WYŁĄCZNIE 4 tabele auth. Adapter nie sięga do żadnej
 * innej tabeli — model spoza tej listy kończy się błędem adaptera (test).
 * Do P6 pula systemowa i pula żądań to ta sama rola bazy: zawężenie dotyczy dziś
 * wyłącznie schematu tego adaptera, nie uprawnień w bazie. Odebranie puli żądań
 * grantów na account/session/verification to dług do P6 (#193, lista kontrolna P6).
 *
 * Wyjątek od Z7/W2 z zamkniętej listy (recenzja 16.11). Importuje go wyłącznie
 * `src/lib/auth.ts` (test skanu importów); nie wychodzi przez `system/index.ts`.
 */
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "@/lib/schema";
import { dbSystem } from "./db-system";

export const authAdapter = drizzleAdapter(dbSystem, {
  provider: "pg",
  schema: { user, session, account, verification },
});

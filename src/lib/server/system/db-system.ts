/**
 * Pula systemowa (#193): jedyne źródło połączenia dla `src/lib/server/system/**`.
 *
 * Do P6 to TEN SAM klient co `db` z `src/lib/db.ts` (decyzja Ethana 16.11):
 * obie pule miałyby ten sam URL, rolę i opcje, więc osobny klient niczego nie
 * izoluje, a dokłada połączenia. Granicę do P6 wyznacza moduł, import i lint.
 * Rozdział (własny klient, `DB_SYSTEM_POOL_MAX`) — lista kontrolna P6 pkt 11.
 *
 * Importować wolno tylko z `system/**` (lint #193). Test tożsamości pilnuje,
 * że ten plik nie robi z `db` nic poza re-eksportem.
 */
import { db } from "@/lib/db";

export const dbSystem: typeof db = db;

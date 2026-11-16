import * as path from 'path';
import {
  decideCleanupTarget,
  E2E_SALON_ID,
  guardedCleanupClient,
  purgeE2eAppointments,
  purgeE2eEmployees,
  resolveCleanupUrl,
} from './e2e-cleanup';
import { isLocalBaseURL } from './global-setup';
import type { FullConfig } from '@playwright/test';

/**
 * Global teardown (#175, #199): twardo usuwa wizyty, a potem pracowników E2E
 * oznaczonych `[E2E]` (`tests/e2e-cleanup.ts`). Dane seeda i wiersze bez
 * znacznika zostają. Kolejność ma znaczenie: usunięcie pracownika zabiera
 * kaskadą jego wizyty, więc oznaczone wizyty znikają najpierw, a bezpiecznik
 * pracowników pilnuje, żeby kaskada nie dotknęła wizyt bez znacznika.
 *
 * Baza: ta, do której pisał serwer testów — `POSTGRES_URL` z procesu (CI ustawia
 * go w jobie), a bez niego z `.env.local` (stamtąd czyta go `next dev`/`next start`).
 * Dwa progi:
 *  1. `decideCleanupTarget`: host i nazwa bazy z jawnych list (localhost/127.0.0.1,
 *     `pos_dev`). Poza listą = pominięcie z komunikatem, bez DELETE i bez błędu.
 *  2. Cel z listy przechodzi pełny strażnik `scripts/seed-host-guard.ts` (hosty
 *     postgres.js, nie Neon, nie `VERCEL_ENV=preview/production`, baza po stronie
 *     serwera); odmowa na tym etapie = czerwony przebieg, nie cichy skip.
 *
 * Połączenie idzie jako właściciel tabel, poza RLS (bez `forSalon`), więc
 * zakres wyznaczają wyłącznie: strażnik hosta, salon seeda (`E2E_SALON_ID`)
 * i znacznik `[E2E]`. Ręczna wizyta z notatką od `[E2E]` albo ręcznie dodany
 * pracownik z imieniem lub nazwiskiem od `[E2E]` w lokalnej bazie też zniknie.
 *
 * Dwa równoległe procesy Playwright na jednej bazie nie są wspierane:
 * teardown pierwszego usuwa oznaczone dane drugiego, który jeszcze biegnie.
 *
 * Zdalny `BASE_URL` (testy @production): teardown pominięty, tamte testy nie
 * zakładają danych, a lokalna baza nie jest bazą testowanego serwera.
 */
async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!isLocalBaseURL(baseURL)) {
    console.warn('[global-teardown] Non-local target: cleanup skipped');
    return;
  }

  const projectDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
  const url = resolveCleanupUrl(process.env, path.join(projectDir, '.env.local'));
  const decision = decideCleanupTarget(url);
  if (!decision.run) {
    console.warn(`[global-teardown] ${decision.reason}`);
    return;
  }
  const sql = await guardedCleanupClient(url, process.env);
  try {
    const a = await purgeE2eAppointments(sql, [E2E_SALON_ID]);
    const e = await purgeE2eEmployees(sql, [E2E_SALON_ID]);
    // console.warn: reguła no-console dopuszcza tylko warn/error; to podsumowanie, nie błąd.
    console.warn(
      `[global-teardown] usunięto wizyt E2E: ${a.deleted}; wizyt bez znacznika: ${a.untouchedBefore} → ${a.untouchedAfter}; ` +
        `pracowników E2E: ${e.deleted}; pracowników bez znacznika: ${e.untouchedBefore} → ${e.untouchedAfter}`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default globalTeardown;

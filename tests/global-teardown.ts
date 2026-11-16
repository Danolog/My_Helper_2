import * as path from 'path';
import type { FullConfig } from '@playwright/test';
import { E2E_SALON_ID, guardedCleanupClient, purgeE2eAppointments, resolveCleanupUrl } from './e2e-cleanup';
import { isLocalBaseURL } from './global-setup';

/**
 * Global teardown (#175): twardo usuwa wizyty E2E oznaczone `[E2E]`
 * (`tests/e2e-cleanup.ts`). Dane seeda i wizyty bez znacznika zostają.
 *
 * Baza: ta, do której pisał serwer testów — `POSTGRES_URL` z procesu (CI ustawia
 * go w jobie), a bez niego z `.env.local` (stamtąd czyta go `next dev`/`next start`).
 * Strażnik `scripts/seed-host-guard.ts` (localhost/127.0.0.1, baza `pos_dev`,
 * nie Neon, nie `VERCEL_ENV=preview/production`); każdy inny cel = odmowa
 * i czerwony przebieg, nie cichy skip.
 *
 * Zdalny `BASE_URL` (testy @production): teardown pominięty, tamte testy nie
 * zakładają wizyt, a lokalna baza nie jest bazą testowanego serwera.
 */
async function globalTeardown(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!isLocalBaseURL(baseURL)) {
    console.warn('[global-teardown] Non-local target: cleanup skipped');
    return;
  }

  const projectDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
  const url = resolveCleanupUrl(process.env, path.join(projectDir, '.env.local'));
  const sql = await guardedCleanupClient(url, process.env);
  try {
    const r = await purgeE2eAppointments(sql, [E2E_SALON_ID]);
    console.log(
      `[global-teardown] usunięto wizyt E2E: ${r.deleted}; wizyt bez znacznika: ${r.untouchedBefore} → ${r.untouchedAfter}`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default globalTeardown;

import { randomInt } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

export { expect };
export type { Page } from '@playwright/test';

/**
 * Wspolna baza testow E2E: kazdy test przychodzi z wlasnego adresu IP.
 *
 * Dlaczego: w buildzie produkcyjnym (CI: `pnpm start`) Better Auth wlacza
 * limit zadan liczony PER ADRES IP (naglowek X-Forwarded-For) i sciezke:
 *   - /sign-in, /sign-up: 3 zadania, potem 429 az do 10 s ciszy,
 *   - pozostale (np. /get-session): 100 zadan, potem 429 az do 10 s ciszy.
 * Licznik zeruje sie dopiero po 10 s BEZ zadnego zadania z danego adresu.
 * Caly zestaw E2E idzie z jednego adresu (localhost) i nigdy nie robi takiej
 * przerwy, wiec testy zjadaly sobie nawzajem limit: logowanie dostawalo 429,
 * a panel nie renderowal sie po 429 z /get-session (E2E Full, 2026-11-14).
 *
 * Realni uzytkownicy przychodza z roznych adresow — ten plik odtwarza to w
 * testach. Limitu w aplikacji NIE zmienia; ze nadal dziala, pilnuje test
 * "should rate-limit repeated sign-in attempts from one client"
 * w tests/auth/authentication.spec.ts.
 *
 * Nie uzywac w tests/production/ — tam ida zadania do prawdziwego wdrozenia.
 */
function uniqueClientIp(): string {
  // 10.0.0.0/8 — adresy prywatne, nie koliduja z niczym realnym.
  return `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export const test = base.extend<{ clientIp: string }>({
  // Drugi parametr to playwrightowe "use"; nazwane inaczej, bo regula ESLint
  // react-hooks bierze "use(...)" za hook Reacta.
  clientIp: async ({}, provide) => {
    await provide(uniqueClientIp());
  },
  extraHTTPHeaders: async ({ extraHTTPHeaders, clientIp }, provide) => {
    await provide({ ...extraHTTPHeaders, 'X-Forwarded-For': clientIp });
  },
});

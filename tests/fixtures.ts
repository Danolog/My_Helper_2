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
 *
 * Zaufane proxy (TRUSTED_PROXIES, src/lib/trusted-proxies.ts): fixture wysyla
 * JEDNA wartosc X-Forwarded-For, tak jak przegladarka bez proxy. Pojedynczy
 * adres spoza listy zaufanych proxy jest adresem klienta zarowno dla Better
 * Auth, jak i dla getClientIp — niezaleznie od tego, czy lista jest pusta
 * (CI, lokalnie, Vercel), czy ustawiona. Adresy losujemy z 198.18.0.0/15
 * (RFC 2544, zakres testowy), a nie z 10.0.0.0/8: waski zakres prywatny
 * 10.x moze legalnie trafic do TRUSTED_PROXIES (np. adres LB w VPC) i wtedy
 * adres testu bylby uznany za proxy, a wszystkie testy wpadlyby do jednego
 * kubelka limitu.
 */
function uniqueClientIp(): string {
  // 198.18.0.0/15 — zakres testowy (RFC 2544), nigdy realny klient ani proxy.
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
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

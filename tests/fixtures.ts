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

/**
 * Straznik CSP dla testow z tagiem `@csp` (dzis: logowanie, panel z toastem
 * sonnera, portal klienta — wszystkie tez w `@smoke`).
 *
 * Dlaczego: przegladarka po cichu blokuje to, co lamie Content-Security-Policy
 * (np. <style> sonnera bez hasha w style-src-elem) — strona sie laduje, asercje
 * na tekst przechodza, a uzytkownik widzi nieostylowane toasty albo martwy
 * skrypt. Bez tego straznika E2E nie wykrywa zlamanego CSP (ustalenie z #34).
 *
 * Dwa niezalezne zrodla, zeby nie zalezec od jednego mechanizmu:
 *   1. zdarzenie `securitypolicyviolation` (init script, przed skryptami strony,
 *      raport przez exposeBinding — przezywa nawigacje i przeladowania),
 *   2. bledy konsoli z "Content Security Policy" (Chromium loguje kazde
 *      zablokowanie niezaleznie od skryptow strony; podaje tez hash, ktorego
 *      brakuje w polityce).
 * Test pada po zakonczeniu, z lista naruszen: dyrektywa, co zablokowano, gdzie.
 *
 * Polityka produkcyjna dziala tylko w buildzie (`pnpm start`, tak jest w CI).
 * Na `pnpm dev` CSP jest celowo luzne (src/proxy.ts, buildCsp), wiec straznik
 * nie ma czego zlapac — lokalnie uruchamiaj na buildzie produkcyjnym.
 */
const CSP_TAG = '@csp';

declare global {
  interface Window {
    __e2eReportCsp?: (violation: string) => void;
  }
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
  page: async ({ page }, provide, testInfo) => {
    if (!testInfo.tags.includes(CSP_TAG)) {
      await provide(page);
      return;
    }

    const events: string[] = [];
    const consoleErrors: string[] = [];

    await page.exposeBinding('__e2eReportCsp', (_source, violation: string) => {
      events.push(violation);
    });
    await page.addInitScript(() => {
      document.addEventListener(
        'securitypolicyviolation',
        (e) => {
          window.__e2eReportCsp?.(
            `${e.effectiveDirective} | zablokowano: ${e.blockedURI || '(inline)'}` +
              ` | ${e.sourceFile || e.documentURI}:${e.lineNumber}` +
              (e.sample ? ` | probka: ${e.sample}` : '')
          );
        },
        true
      );
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    await provide(page);

    // Zdarzenia ida do testu asynchronicznie (binding) — chwila na doplyw
    // ostatnich, zanim ocenimy wynik. Strona moze byc juz zamknieta.
    await page.waitForTimeout(250).catch(() => {});

    expect(
      { securitypolicyviolation: events, consoleErrors },
      `Naruszenia Content-Security-Policy na ${page.url()} — przegladarka zablokowala zasob albo styl.`
    ).toEqual({ securitypolicyviolation: [], consoleErrors: [] });
  },
});

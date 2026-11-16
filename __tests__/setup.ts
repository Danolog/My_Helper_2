import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// #193 P0b — bezpiecznik delegujący puli systemowej (Ethan, „Mocki — DECYZJA 2”).
// Do P6 `dbSystem` to ten sam klient co `db` (re-eksport w db-system.ts):
// - `@/lib/db` zmockowane w pliku testu → `dbSystem` = to samo zmockowane `db`
//   (jak prawdziwy re-eksport; dziś kontekst też idzie przez ten mock);
// - `@/lib/db` prawdziwe (Proxy z db.ts) → każde użycie `dbSystem` = głośny błąd,
//   zamiast cichego zapytania do bazy z env.
// Jawny `vi.mock("@/lib/server/system/db-system", …)` w pliku testu wygrywa
// (osobny strumień w uprzęży salon-staff-harness).
// P6 pkt 11: po rozdziale pul delegacja znika, bezpiecznik tylko rzuca.
vi.mock('@/lib/server/system/db-system', async () => {
  const [{ db }, { types }] = await Promise.all([import('@/lib/db'), import('node:util')]);
  if (!types.isProxy(db)) return { dbSystem: db };
  return {
    dbSystem: new Proxy(
      {},
      {
        get(_target, prop) {
          // Nie udawaj obietnicy (await/Promise.resolve na module ani obiekcie).
          if (prop === 'then') return undefined;
          throw new Error(
            `niezamockowany dbSystem w teście jednostkowym (dostęp do "${String(prop)}") — ` +
              'zmockuj @/lib/db albo @/lib/server/system/db-system w pliku testu'
          );
        },
      }
    ),
  };
});

// Limit findBy*/waitFor bez jawnego { timeout }: w CI domyslny Testing Library
// (1000 ms) — bramka bez zmian; lokalnie 3000 ms, bo pod obciazeniem maszyny
// render + effect potrafia nie zdazyc w 1 s mimo poprawnego kodu.
// Uzasadnienie i pomiar: vitest.config.ts (testTimeout/hookTimeout).
configure({ asyncUtilTimeout: process.env.CI ? 1000 : 3000 });

/**
 * Niezmiennik zakresu salonu z query (#94, Ethan; po wycieku #73 i #94):
 *
 *   każdy handler trasy API, który czyta `salonId` z query, przekazuje go
 *   strażnikowi porównującemu z salonem z sesji — `requireSalonStaff({
 *   requestedSalonId })` albo `requireReportSalon(request)` — PRZED pierwszym
 *   zapytaniem, albo jest na jawnej liście wyjątków z powodem i dowodem.
 *
 * Wzorzec wycieku, który ten test łapie: `forSalon(searchParams.get("salonId"))`
 * — forSalon ustawia kontekst RLS na podany salon, więc wartość od
 * atakującego omija RLS (#73: /api/services, #94: /api/service-categories).
 *
 * Wyjątek nie jest „zaufaj mi”: każdy ma dowód strukturalny sprawdzany tutaj
 * (strażnik przed zapytaniem + wzorzec, który zawęża dane). Zmiana trasy,
 * która usunie dowód, wywraca test; wyjątek, który przestał być potrzebny
 * (trasa spełnia regułę ogólną albo nie czyta już salonId), też.
 *
 * Granice skanera (nazwane, nie ukryte — Ethan, recenzja #99; „pilnuje” =
 * osobny test niżej, „poza zasięgiem” = świadomie nie sprawdzane):
 *
 *   1. Tylko query i tylko nazwa `salonId`. Inna nazwa tego samego parametru
 *      (`salon_id`, `salon`, `salonID`, `salon-id`) — pilnuje test „aliasy”.
 *   2. Całe query naraz (`Object.fromEntries(searchParams)`, `.entries()`,
 *      `.forEach()`) — pilnuje test „hurtem”.
 *   3. Handler tylko jako `export const|async function|function METODA`.
 *      Reeksport (`export { h as GET }`) — pilnuje test „reeksport”.
 *   4. Poza zasięgiem: salonId z segmentu ścieżki (`[salonId]`) i z body —
 *      inne źródło, inny wzorzec (POST/PUT już przez requireSalonStaff z body).
 *   5. Poza zasięgiem: przepływ danych. Skaner widzi, że strażnik stoi przed
 *      pierwszym zapytaniem, nie że zapytanie używa `guard.ctx.salonId`.
 *      Strażnik z requestedSalonId odrzuca inny salon (403), więc po nim
 *      wartość z query i z sesji są równe — z wyjątkiem pustego query
 *      (wtedy salon z sesji). Kontrakt (salon-query-scope-contract.test.ts)
 *      sprawdza to zachowaniem, nie tekstem.
 *   6. Komentarze są wycinane przed analizą; stringi nie (`"// ..."` w
 *      stringu może uciąć resztę linii — dziś nie występuje w `src/app/api`).
 */
import { describe, it, expect } from "vitest";
import { isModuleFrozen } from "@/lib/features";
import {
  allRouteFiles,
  filesReadingSalonIdQuery,
  guardedBySessionSalon,
  handlersReadingSalonIdQuery,
  indexBeforeDataAccess,
  readRoute,
} from "./salon-query-scope";

interface Exception {
  reason: string;
  /** Strażnik, który musi stać przed pierwszym zapytaniem w handlerze. */
  guard: RegExp;
  /** Wzorzec, który zawęża dane (musi wystąpić w handlerze). */
  proof: RegExp;
}

const CRON: Exception = {
  reason: "trasa systemowa crona: sekret crona, nie sesja; salonId zawęża przebieg, nie uprawnienia",
  guard: /requireCronSecret\(request\)/,
  proof: /if \(cronError\) return cronError/,
};

const FROZEN_PROMOTIONS: Exception = {
  reason:
    "moduł complexPromotions zamrożony: 404 przed czymkolwiek. Trasa nie ma sesji i przyjmuje clientId — " +
    "odmrożenie wymaga przeglądu Ryana (test niżej pada, gdy moduł przestanie być zamrożony)",
  guard: /frozenModuleResponse\("complexPromotions"\)/,
  proof: /if \(frozen\) return frozen/,
};

const FAVORITES: Exception = {
  reason: "ulubione klienta: wiersze tylko zalogowanego użytkownika, salonId to tylko filtr w jego liście",
  guard: /requireAuth\(\)/,
  proof: /eq\(favoriteSalons\.clientUserId, userId\)/,
};

/** Klucz: `plik#METODA`. */
const EXCEPTIONS: Record<string, Exception> = {
  "src/app/api/notifications/birthday/route.ts#GET": CRON,
  "src/app/api/notifications/low-stock/route.ts#GET": CRON,
  "src/app/api/notifications/we-miss-you/route.ts#GET": CRON,
  "src/app/api/reminders/appointment/route.ts#GET": CRON,
  "src/app/api/reminders/appointment/route.ts#POST": CRON,
  "src/app/api/promotions/check/route.ts#GET": FROZEN_PROMOTIONS,
  "src/app/api/promotions/check-happy-hours/route.ts#GET": FROZEN_PROMOTIONS,
  "src/app/api/promotions/check-package/route.ts#GET": FROZEN_PROMOTIONS,
  "src/app/api/favorites/salons/check/route.ts#GET": FAVORITES,
  "src/app/api/favorites/salons/route.ts#DELETE": FAVORITES,
  "src/app/api/clients/deposit-settings/route.ts#GET": {
    reason:
      "portal klienta: salon to cel rezerwacji (publiczny), rekord klienta wyłącznie po zweryfikowanym e-mailu sesji",
    guard: /requireAuth\(\)/,
    proof: /verifiedClientMatchEmail\(authResult\.user\)/,
  },
  "src/app/api/gallery/route.ts#GET": {
    reason: "własne porównanie z sesją: getSalonContext, inny salonId => 403, zakres z ctx",
    guard: /getSalonContext\(\)/,
    proof: /requestedSalonId && requestedSalonId !== ctx\.salonId[\s\S]*?status: 403[\s\S]*?const salonId = ctx\.salonId;/,
  },
  "src/app/api/work-schedules/by-salon/route.ts#GET": {
    reason: "query tylko dla kształtu żądania (wymagane, nieużywane); zakres z getSalonContext",
    guard: /getSalonContext\(\)/,
    proof: /const salonId = ctx\.salonId;/,
  },
  "src/app/api/available-slots/route.ts#GET": {
    reason:
      "publiczne wolne terminy bez sesji: salonId z query to cel rezerwacji, walidowany jako UUID przed forSalon; " +
      "pracownik musi należeć do tego salonu (obcy i nieistniejący → ta sama 404), odczyty z jawnymi listami kolumn",
    guard: /if \(!salonId \|\| !isValidUuid\(salonId\)\)/,
    proof:
      /eq\(employees\.id, employeeId\), eq\(employees\.salonId, salonId\)[\s\S]*?if \(!result\.employeeFound\)[\s\S]*?EMPLOYEE_NOT_FOUND_BODY, \{ status: 404 \}/,
  },
  "src/app/api/dashboard/stats/route.ts#GET": {
    reason: "własna weryfikacja własności (ADR-001 R2b): salon z query tylko gdy ownerId = użytkownik sesji, inaczej 403",
    guard: /auth: "user"/,
    proof: /eq\(salons\.ownerId, user\.id\)/,
  },
};

const handlers = handlersReadingSalonIdQuery();
const key = (h: { file: string; method: string }) => `${h.file}#${h.method}`;

describe("niezmiennik: salonId z query przechodzi przez strażnika salonu z sesji (#94)", () => {
  it("skaner coś znajduje (test nie jest pusty) i widzi trasy z #73/#94", () => {
    expect(handlers.length).toBeGreaterThanOrEqual(30);
    const keys = handlers.map(key);
    expect(keys).toContain("src/app/api/services/route.ts#GET");
    expect(keys).toContain("src/app/api/service-categories/route.ts#GET");
  });

  it("każdy odczyt salonId z query leży w eksportowanym handlerze", () => {
    const inHandlers = new Set(handlers.map((h) => h.file));
    expect(filesReadingSalonIdQuery().filter((f) => !inHandlers.has(f))).toEqual([]);
  });

  it("handler spoza listy wyjątków spełnia regułę ogólną", () => {
    const offenders = handlers
      .filter((h) => !(key(h) in EXCEPTIONS))
      .filter((h) => !guardedBySessionSalon(h.body))
      .map(key);
    expect(offenders).toEqual([]);
  });

  it("każdy wyjątek ma strażnika przed zapytaniem i dowód zawężenia", () => {
    const broken = handlers
      .filter((h) => key(h) in EXCEPTIONS)
      .filter((h) => {
        const e = EXCEPTIONS[key(h)]!;
        return indexBeforeDataAccess(h.body, e.guard) < 0 || !e.proof.test(h.body);
      })
      .map(key);
    expect(broken).toEqual([]);
  });

  it("lista wyjątków nie ma martwych wpisów", () => {
    const byKey = new Map(handlers.map((h) => [key(h), h]));
    const stale = Object.keys(EXCEPTIONS).filter((k) => {
      const h = byKey.get(k);
      // Nie czyta już salonId z query albo spełnia regułę ogólną => usuń wpis.
      return !h || guardedBySessionSalon(h.body);
    });
    expect(stale).toEqual([]);
  });

  it("każdy wyjątek ma powód", () => {
    expect(Object.values(EXCEPTIONS).every((e) => e.reason.length > 20)).toBe(true);
  });

  it("wyjątek trasy bez sesji obowiązuje tylko póki complexPromotions jest zamrożony", () => {
    expect(isModuleFrozen("complexPromotions")).toBe(true);
  });

  it("aliasy: żadna trasa nie czyta salonu z query pod inną nazwą niż salonId", () => {
    const aliases: string[] = [];
    for (const file of allRouteFiles()) {
      for (const m of readRoute(file).matchAll(/\.get\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
        const key = m[1]!;
        const normalized = key.toLowerCase().replace(/[-_]/g, "");
        if ((normalized === "salon" || normalized === "salonid") && key !== "salonId") {
          aliases.push(`${file}: ${key}`);
        }
      }
    }
    expect(aliases).toEqual([]);
  });

  it("reeksport: żaden handler nie jest eksportowany przez `export { … as METODA }`", () => {
    const reexports = allRouteFiles().filter((file) =>
      /export\s*\{[^}]*\b(?:as\s+)?(?:GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/.test(readRoute(file))
    );
    expect(reexports).toEqual([]);
  });

  it("hurtem: żadna trasa nie czyta całego query naraz", () => {
    const bulk = allRouteFiles().filter((file) =>
      /fromEntries\([^)]*searchParams|searchParams\.(?:entries|forEach)\(/.test(readRoute(file))
    );
    expect(bulk).toEqual([]);
  });
});

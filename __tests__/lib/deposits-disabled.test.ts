/**
 * Strażnik wyłączonego zadatku.
 *
 * `isDepositEnabled()` w `src/lib/features.ts` to jedyne miejsce przełączenia.
 * Na tej gałęzi zwraca false: salon nie może wymagać zadatku, a żadna
 * rezerwacja nie prowadzi do płatności. Włączenie to świadoma zmiana tego
 * testu razem z flagą — dopiero po zatwierdzeniu ścieżki zadatku.
 *
 * Do tego: każdy egzekutor nadal pyta flagę. Usunięcie bramki z którejś
 * trasy (przy refaktorze) wywraca ten test, zanim dotrze do produkcji.
 * Zachowanie tras (409 / 400 / 200) sprawdzają testy API: services.test.ts,
 * clients.test.ts, deposits-disabled.test.ts, appointments-deposits-disabled.test.ts,
 * salons-id-public.test.ts, clients-deposit-settings.test.ts; wyliczenie
 * zadatku — deposit-calculation.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DEPOSITS_DISABLED_CODE,
  DEPOSITS_DISABLED_MESSAGE,
  isBlikDepositFlow,
  isDepositEnabled,
} from "@/lib/features";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Egzekutorzy flagi: plik → co bramkuje. */
const ENFORCERS: ReadonlyArray<{ path: string; field: string | null }> = [
  { path: "src/app/api/services/[id]/route.ts", field: "depositRequired" },
  { path: "src/app/api/clients/[id]/route.ts", field: "requireDeposit" },
  { path: "src/app/api/clients/route.ts", field: "requireDeposit" },
  { path: "src/app/api/deposits/create-session/route.ts", field: null },
  { path: "src/lib/deposit-calculation.ts", field: null },
  // Odczyty zasilające portal: maskują flagę zadatku w odpowiedzi.
  { path: "src/app/api/salons/[id]/route.ts", field: null },
  { path: "src/app/api/clients/deposit-settings/route.ts", field: null },
];

describe("zadatek wyłączony — stan na tej gałęzi", () => {
  it("isDepositEnabled() zwraca false", () => {
    expect(isDepositEnabled()).toBe(false);
  });

  it("ścieżka BLIK też nieprzełączona (zadatek nie wraca inną drogą)", () => {
    expect(isBlikDepositFlow()).toBe(false);
  });

  it("kod błędu i komunikat dla użytkownika po polsku", () => {
    expect(DEPOSITS_DISABLED_CODE).toBe("DEPOSITS_DISABLED");
    expect(DEPOSITS_DISABLED_MESSAGE).toBe("Zadatki są obecnie wyłączone. Wizyty rezerwuje się bez zadatku.");
  });
});

describe("zadatek wyłączony — każdy egzekutor pyta flagę", () => {
  it.each(ENFORCERS)("$path woła isDepositEnabled()", ({ path }) => {
    const code = source(path);
    expect(code).toMatch(/import\s*\{[^}]*\bisDepositEnabled\b[^}]*\}\s*from\s*"@\/lib\/features"/);
    expect(code).toContain("!isDepositEnabled()");
  });

  it.each(ENFORCERS.filter((e) => e.field !== null))(
    "$path odrzuca tylko $field === true (false i brak pola przechodzą)",
    ({ path, field }) => {
      expect(source(path)).toMatch(new RegExp(`${field} === true && !isDepositEnabled\\(\\)`));
    }
  );

  it.each(ENFORCERS.filter((e) => e.path.startsWith("src/app/api/") && e.field !== null))(
    "$path odpowiada 409 z DEPOSITS_DISABLED_CODE",
    ({ path }) => {
      const code = source(path);
      expect(code).toContain("code: DEPOSITS_DISABLED_CODE");
      expect(code).toMatch(/DEPOSITS_DISABLED_MESSAGE\s*\},\s*\{\s*status:\s*409\s*\}/);
    }
  );

  // Publiczna trasa rezerwacji: 400 z kodem, który portal rozpoznaje jako
  // „rezerwuj bez zadatku”; 409 front i stare PWA pokazują jako „termin zajęty”.
  it("create-session odpowiada 400 z DEPOSIT_NOT_APPLICABLE_CODE (nie 409)", () => {
    const code = source("src/app/api/deposits/create-session/route.ts");
    const gate = code.indexOf("!isDepositEnabled()");
    const gateBlock = code.slice(gate, code.indexOf("await getOptionalSession()"));
    expect(gateBlock).toContain("code: DEPOSIT_NOT_APPLICABLE_CODE");
    expect(gateBlock).toContain("reason: DEPOSITS_DISABLED_CODE");
    expect(gateBlock).toMatch(/\{\s*status:\s*400\s*\}/);
    expect(gateBlock).not.toMatch(/status:\s*409/);
  });

  it("create-session: bramka stoi przed odczytem sesji i przed dostawcą płatności", () => {
    const code = source("src/app/api/deposits/create-session/route.ts");
    const gate = code.indexOf("!isDepositEnabled()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(code.indexOf("await getOptionalSession()"));
    expect(gate).toBeLessThan(code.indexOf("isStripeConfigured()"));
    expect(gate).toBeLessThan(code.indexOf("checkout.sessions.create"));
  });
});

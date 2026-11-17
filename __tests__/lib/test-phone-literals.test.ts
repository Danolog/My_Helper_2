import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { isTestPhoneNumber } from "@/lib/test-phone";

/**
 * Każdy telefon w seedach i w testach E2E jest na TEST_PHONE_NUMBERS (#75).
 *
 * E2E tworzące wizytę wołają SMS potwierdzenia na telefon klientki z seeda.
 * Z ustawionym SMSAPI_TOKEN numer spoza listy oznaczałby prawdziwą próbę
 * wysyłki (Ryan, recenzja #107). `sendSms` blokuje tylko numery z listy.
 *
 * Pliki czytamy jako tekst: `scripts/seed-test.ts` po imporcie łączy się z bazą
 * (ten sam powód co w seed-ids.test.ts).
 */
const SEED_FILES = ["scripts/seed-test.ts", "src/lib/server/system/seed.ts"];
const E2E_DIR = "tests";

// Literał napisowy wyglądający na polski numer: +48 i 9 cyfr albo 9 cyfr (spacje/myślniki dozwolone).
const PHONE_LITERAL = /["'`](\+48[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}|\d{3}[ -]?\d{3}[ -]?\d{3})["'`]/g;

// Podpowiedź pola formularza (placeholder) to nie numer, na który cokolwiek idzie.
const IGNORED_CONTEXT = /getByPlaceholder\(\s*$/;

function e2eFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === ".auth" ? [] : e2eFiles(p);
    return /\.ts$/.test(name) ? [p] : [];
  });
}

function phoneLiterals(file: string): Array<{ file: string; line: number; value: string }> {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  return [...src.matchAll(PHONE_LITERAL)]
    .filter((m) => !IGNORED_CONTEXT.test(src.slice(Math.max(0, m.index! - 40), m.index!)))
    .map((m) => ({ file, line: src.slice(0, m.index!).split("\n").length, value: m[1]! }));
}

describe("telefony w seedach i E2E są numerami testowymi", () => {
  const files = [...SEED_FILES, ...e2eFiles(E2E_DIR)];
  const found = files.flatMap(phoneLiterals);

  it("skan coś znajduje (strażnik, żeby test nie przechodził pusto)", () => {
    // salon + 2 klientki (seed-test), salon + 3 klientki (seed API), pracownik E2E
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it("każdy znaleziony numer jest na TEST_PHONE_NUMBERS", () => {
    const offenders = found.filter((f) => !isTestPhoneNumber(f.value));
    expect(offenders).toEqual([]);
  });

  it("wzorzec łapie dawne numery seeda (kontrola pozytywna)", () => {
    const sample = `phone: "+48 111 222 333", other: '500100200', ph: getByPlaceholder('+48 123 456 789')`;
    const hits = [...sample.matchAll(PHONE_LITERAL)]
      .filter((m) => !IGNORED_CONTEXT.test(sample.slice(Math.max(0, m.index! - 40), m.index!)))
      .map((m) => m[1]);
    expect(hits).toEqual(["+48 111 222 333", "500100200"]);
    expect(hits.some((h) => isTestPhoneNumber(h!))).toBe(false);
  });

  it("seed-test.ts aktualizuje telefon przy reseedzie (phone w set onConflictDoUpdate)", () => {
    const src = readFileSync(join(process.cwd(), "scripts/seed-test.ts"), "utf8");
    expect(src).toMatch(/set: \{ firstName: c\.firstName, lastName: c\.lastName, phone: c\.phone \}/);
    expect(src).toMatch(/set: \{ name: "Beauty Studio Demo", phone: "\+48 000 600 704"/);
  });
});

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Stałe id z seeda muszą być prawdziwymi UUID v4.
 *
 * Produkcja generuje id przez `uuid().defaultRandom()`, a walidacja tras
 * (`z.string().uuid()` z Zod 4) sprawdza wersję i wariant. Seed z id w rodzaju
 * `00000000-0000-0000-0000-000000000001` przechodził przez bazę, ale walidacja
 * go odrzucała. Przez to rezerwacja z zadatkiem nie dawała się przetestować
 * na danych testowych (`POST /api/deposits/create-session` → 400
 * „salonId musi byc poprawnym UUID”).
 *
 * Pliki czytamy jako tekst, a nie importujemy, bo `scripts/seed-test.ts`
 * po imporcie od razu łączy się z bazą.
 */
const SEED_FILES = ["scripts/seed-test.ts", "src/app/api/seed/route.ts"];

// Wszystko, co wygląda na UUID (8-4-4-4-12 hex) w literałach napisowych.
const UUID_LIKE = /["'`]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})["'`]/g;

const uuidSchema = z.string().uuid();

function idsIn(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  return [...src.matchAll(UUID_LIKE)].map((m) => m[1]!);
}

describe("stałe id seeda są poprawnymi UUID dla z.string().uuid()", () => {
  it("seed-test.ts zawiera stałe id (strażnik, żeby test nie przechodził pusto)", () => {
    expect(idsIn("scripts/seed-test.ts").length).toBeGreaterThanOrEqual(11);
  });

  for (const file of SEED_FILES) {
    it(`${file}: każde id przechodzi z.string().uuid()`, () => {
      const ids = idsIn(file);
      expect(ids.length).toBeGreaterThan(0);
      const invalid = ids.filter((id) => !uuidSchema.safeParse(id).success);
      expect(invalid).toEqual([]);
    });
  }

  it("stary format (wersja 0, wariant 0) jest odrzucany: test łapie regresję", () => {
    expect(uuidSchema.safeParse("00000000-0000-0000-0000-000000000001").success).toBe(false);
    expect(uuidSchema.safeParse("00000000-0000-4000-8000-000000000001").success).toBe(true);
  });

  it("id seeda są unikalne", () => {
    const ids = idsIn("scripts/seed-test.ts");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

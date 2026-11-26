// @vitest-environment node
/**
 * Strażnik ścieżek zakładania salonu (beta na zaproszenie).
 *
 * Bramka bety stoi w trasie POST /api/register-subscription, bo to jedyne
 * produkcyjne miejsce, w którym powstaje wiersz `salons`. Ten test pilnuje tego
 * założenia: `.insert(salons)` w `src/` wolno tylko w tej trasie i w seedzie.
 * Nowa ścieżka = czerwony test i świadoma decyzja, czy bramkę przenieść do
 * wspólnej funkcji serwerowej zakładającej salon.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const ALLOWED = [
  "src/app/api/register-subscription/route.ts", // za bramką bety
  "src/lib/server/system/seed.ts", // seed danych demo, poza ruchem użytkowników
];

/** `.insert(salons)` i `.insert(schema.salons)`, także z białymi znakami i w nowej linii. */
const INSERT_SALONS = /\.insert\(\s*(?:[A-Za-z_$][\w$]*\.)?salons\s*\)/;

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f));
}

describe("zakładanie salonu — jedyne ścieżki", () => {
  it("wzorzec łapie znane formy zapisu i pomija inne tabele", () => {
    expect(INSERT_SALONS.test("tx.insert(salons).values({})")).toBe(true);
    expect(INSERT_SALONS.test("db\n  .insert( salons )\n  .values({})")).toBe(true);
    expect(INSERT_SALONS.test("db.insert(schema.salons)")).toBe(true);
    expect(INSERT_SALONS.test("db.insert(salonSubscriptions)")).toBe(false);
    expect(INSERT_SALONS.test("db.insert(favoriteSalons)")).toBe(false);
  });

  it("`.insert(salons)` występuje w src/ wyłącznie w trasie register-subscription i w seedzie", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const hits = files.filter((f) => INSERT_SALONS.test(readFileSync(join(REPO_ROOT, f), "utf8"))).sort();
    expect(hits).toEqual([...ALLOWED].sort());
  });
});

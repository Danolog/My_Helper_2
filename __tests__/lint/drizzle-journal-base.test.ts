// @vitest-environment node
/**
 * Strażnik dziennika migracji względem `main` (`origin/main:drizzle/meta/_journal.json`).
 *
 * Migrator Drizzle stosuje tylko wpisy, których `when` jest większe od `created_at`
 * ostatniej zastosowanej migracji. Bazy wdrożone z `main` mają zastosowany cały
 * dziennik `main`. Dziennik gałęzi musi więc:
 * - zaczynać się dokładnie od dziennika `main` (te same `idx`, `tag`, `when`,
 *   w tej samej kolejności): przenumerowanie albo przestawienie wpisu z `main`
 *   zmieniłoby to, co migrator uważa za zastosowane;
 * - mieć każdy dodatkowy wpis z `when` większym niż ostatni `when` z `main`.
 *   Inaczej baza z `main` uzna go za zastosowany i po cichu pominie.
 *
 * Przykład, który łapie tylko ta kontrola: przy konflikcie dziennika wpisy ułożone
 * według `when`, czyli migracje gałęzi jako 0015–0017, a nowsza migracja z `main`
 * przenumerowana na 0018. Dziennik jest wewnętrznie spójny, ale na bazie z `main`
 * migracje 0015–0017 nigdy się nie wykonają.
 *
 * Na samym `main` dziennik jest identyczny z `origin/main`, więc test przechodzi.
 * W CI brak `origin/main` jest błędem (job musi pobrać `main`).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const JOURNAL_PATH = "drizzle/meta/_journal.json";
const BASE_REF = "origin/main";

type JournalEntry = { idx: number; when: number; tag: string };
type Journal = { entries: JournalEntry[] };

/** Zwraca listę naruszeń; pusta lista = dziennik gałęzi bezpiecznie rozszerza dziennik bazowy. */
function journalExtensionViolations(base: JournalEntry[], branch: JournalEntry[]): string[] {
  const violations: string[] = [];
  const key = (e: JournalEntry | undefined) => (e ? `${e.idx}|${e.tag}|${e.when}` : "(brak)");

  base.forEach((b, i) => {
    const e = branch[i];
    if (key(b) !== key(e)) {
      violations.push(`pozycja ${i}: w ${BASE_REF} ${key(b)}, w gałęzi ${key(e)}`);
    }
  });

  const lastBaseWhen = base.at(-1)?.when ?? Number.NEGATIVE_INFINITY;
  for (const e of branch.slice(base.length)) {
    if (!(e.when > lastBaseWhen)) {
      violations.push(
        `${e.tag}: when ${e.when} nie jest większe od ostatniego when w ${BASE_REF} (${lastBaseWhen})`
      );
    }
  }
  return violations;
}

/** Czyta dziennik z `origin/main`; brak refa kończy się czytelnym błędem z instrukcją. */
function readBaseJournal(): Journal {
  try {
    const raw = execFileSync("git", ["show", `${BASE_REF}:${JOURNAL_PATH}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(raw) as Journal;
  } catch (error) {
    const where = process.env.CI
      ? "W CI job z testami musi pobrać main przed testami (krok git fetch w quality-gate.yml)."
      : "Uruchom `git fetch origin main` i powtórz testy.";
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Nie da się odczytać ${BASE_REF}:${JOURNAL_PATH}. ${where}\n${detail}`);
  }
}

const entry = (idx: number, name: string, when: number): JournalEntry => ({
  idx,
  tag: `${String(idx).padStart(4, "0")}_${name}`,
  when,
});

describe("journalExtensionViolations — reguła prefiksu", () => {
  const main = [entry(0, "init", 100), entry(1, "users", 200)];

  it("identyczne dzienniki: brak naruszeń", () => {
    expect(journalExtensionViolations(main, [...main])).toEqual([]);
  });

  it("gałąź dopisuje wpisy z późniejszym when: brak naruszeń", () => {
    expect(journalExtensionViolations(main, [...main, entry(2, "a", 300), entry(3, "b", 400)])).toEqual([]);
  });

  it("konflikt rozwiązany według when (migracja z main przenumerowana na koniec): naruszenie", () => {
    // main dostał własne 0002 (when 500) po tym, jak gałąź dodała 0002–0004 (when 300–320).
    const mainWithOwn = [...main, entry(2, "main_own", 500)];
    const sortedByWhen = [
      ...main,
      entry(2, "branch_a", 300),
      entry(3, "branch_b", 310),
      entry(4, "branch_c", 320),
      entry(5, "main_own", 500),
    ];
    const violations = journalExtensionViolations(mainWithOwn, sortedByWhen);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain("pozycja 2");
  });

  it("wpisy gałęzi po wpisie z main, ale z oryginalnym (wcześniejszym) when: naruszenie", () => {
    const mainWithOwn = [...main, entry(2, "main_own", 500)];
    const branch = [...mainWithOwn, entry(3, "branch_a", 300)];
    expect(journalExtensionViolations(mainWithOwn, branch)).toEqual([
      expect.stringContaining("0003_branch_a: when 300"),
    ]);
  });

  it("dodatkowy wpis z when równym ostatniemu z main: naruszenie", () => {
    expect(journalExtensionViolations(main, [...main, entry(2, "a", 200)])).toHaveLength(1);
  });

  it("gałąź bez wpisu z main albo ze zmienionym when: naruszenie", () => {
    expect(journalExtensionViolations(main, [main[0]!])).toHaveLength(1);
    expect(journalExtensionViolations(main, [main[0]!, entry(1, "users", 201)])).toHaveLength(1);
  });

  it("pusty dziennik bazowy: każdy dziennik gałęzi przechodzi", () => {
    expect(journalExtensionViolations([], main)).toEqual([]);
  });
});

describe(`drizzle/meta/_journal.json rozszerza dziennik z ${BASE_REF}`, () => {
  it("dziennik main jest początkiem dziennika gałęzi, a nowe wpisy mają późniejsze when", () => {
    const base = readBaseJournal().entries;
    const branch = (JSON.parse(fs.readFileSync(path.join(ROOT, JOURNAL_PATH), "utf8")) as Journal).entries;
    expect(base.length).toBeGreaterThan(0);
    expect(journalExtensionViolations(base, branch)).toEqual([]);
  });
});

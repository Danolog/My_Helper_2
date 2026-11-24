// @vitest-environment node
/**
 * Strażnik dziennika migracji `drizzle/meta/_journal.json`.
 *
 * Migrator Drizzle (`drizzle-orm/.../migrator`, ten sam w `drizzle-kit migrate`
 * i w `infra/db/migrate.mjs`) bierze z bazy OSTATNI wpis `__drizzle_migrations`
 * (po `created_at`) i stosuje tylko wpisy dziennika, których `when` jest od niego
 * większe. Nie porównuje hashy ani nazw. Skutki dla dziennika:
 * - `when` musi rosnąć ściśle w kolejności wpisów: wpis o `when` mniejszym lub
 *   równym poprzedniemu zostałby po cichu pominięty na bazie, która ma już poprzedni;
 * - `when` ostatniego wpisu nie może leżeć w przyszłości: ręcznie wpisany znacznik
 *   „z przyszłości” sprawiłby, że kolejna migracja z `drizzle-kit generate`
 *   (`when = Date.now()`) miałaby mniejsze `when` i zostałaby pominięta;
 * - brak pliku `.sql` dla wpisu przerywa migrator, a plik `.sql` bez wpisu
 *   nigdy się nie wykona.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE = path.resolve(__dirname, "../../drizzle");
const JOURNAL = path.join(DRIZZLE, "meta/_journal.json");

/** Zapas na różnicę zegarów maszyn, na których powstają migracje i biegnie CI. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
/** Prefiks numeru w nazwie pliku i `tag`: `NNNN_nazwa`. */
const TAG_PATTERN = /^(\d{4})_[a-z0-9_]+$/;

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8")) as Journal;
const entries = journal.entries;
const sqlFiles = fs
  .readdirSync(DRIZZLE)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("drizzle/meta/_journal.json — kolejność i spójność z plikami", () => {
  it("dziennik dla postgresql i niepusta lista wpisów", () => {
    expect(journal.dialect).toBe("postgresql");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("idx zaczynają się od 0 i rosną o 1 bez luk", () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });

  it("tag ma postać NNNN_nazwa, a NNNN == idx", () => {
    for (const e of entries) {
      const match = TAG_PATTERN.exec(e.tag);
      expect(match, `tag „${e.tag}”`).not.toBeNull();
      expect(Number(match![1]), `tag „${e.tag}” vs idx ${e.idx}`).toBe(e.idx);
    }
  });

  it("when to liczba całkowita (ms) i rośnie ściśle", () => {
    let prev: JournalEntry | undefined;
    for (const e of entries) {
      expect(Number.isSafeInteger(e.when), `when wpisu ${e.tag}`).toBe(true);
      if (prev) expect(e.when, `when ${e.tag} musi być > when ${prev.tag}`).toBeGreaterThan(prev.when);
      prev = e;
    }
  });

  it("when ostatniego wpisu nie leży w przyszłości o więcej niż dobę", () => {
    const last = entries.at(-1)!;
    expect(last.when, `when ${last.tag} = ${new Date(last.when).toISOString()}`).toBeLessThanOrEqual(
      Date.now() + MAX_FUTURE_SKEW_MS
    );
  });

  it("każdy wpis ma plik .sql, a każdy plik .sql ma wpis", () => {
    expect(sqlFiles).toEqual(entries.map((e) => `${e.tag}.sql`));
  });

  it("tagi są unikalne", () => {
    expect(new Set(entries.map((e) => e.tag)).size).toBe(entries.length);
  });
});

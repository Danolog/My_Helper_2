// @vitest-environment node
/**
 * Każda migracja od 0015 zaczyna się od `SET LOCAL lock_timeout = '5s';`.
 *
 * Migrator Drizzle stosuje wszystkie zaległe migracje w jednej transakcji i nie
 * ustawia żadnego limitu czekania na blokadę. Migracja, która bierze blokadę na
 * tabeli z ruchem (ALTER TABLE, LOCK TABLE, CREATE INDEX), czekałaby wtedy bez
 * końca, a za nią w kolejce stawałyby zapytania aplikacji. Limit ustawiamy w samym
 * pliku, a nie na połączeniu migratora, bo migracje biegną dwiema drogami
 * (`drizzle-kit migrate` i obraz migratora z `infra/db/migrate.mjs`); plik jest
 * jedynym miejscem wspólnym dla obu.
 *
 * Każdy plik musi mieć własne SET LOCAL, bo nie wiadomo, od którego pliku zacznie
 * się dany przebieg (baza może mieć już zastosowane wcześniejsze).
 *
 * `statement_timeout` celowo NIE jest wymagany ani dozwolony w tym miejscu:
 * przerwałby długą, poprawną migrację (budowa indeksu, UPDATE dużej tabeli).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DRIZZLE = path.resolve(__dirname, "../../drizzle");
/** Pierwsza migracja objęta regułą. Starsze są już zastosowane na bazach i zostają bez zmian. */
const FIRST_GUARDED_IDX = 15;
const LOCK_TIMEOUT_STATEMENT = "SET LOCAL lock_timeout = '5s';";

type JournalEntry = { idx: number; tag: string };
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

/** Instrukcje pliku w kolejności wykonania, bez linii komentarza `--`. */
function statementsOf(tag: string): string[] {
  return fs
    .readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

const guarded = journal.entries.filter((e) => e.idx >= FIRST_GUARDED_IDX);

describe(`migracje od ${String(FIRST_GUARDED_IDX).padStart(4, "0")} — lock_timeout`, () => {
  it("reguła obejmuje co najmniej 0015, 0016 i 0017", () => {
    expect(guarded.map((e) => e.idx)).toEqual(expect.arrayContaining([15, 16, 17]));
  });

  it.each(guarded.map((e) => e.tag))("%s: pierwsza instrukcja to SET LOCAL lock_timeout = '5s'", (tag) => {
    // Osobna instrukcja (po niej statement-breakpoint), żeby limit obowiązywał,
    // zanim pierwsza instrukcja DDL zacznie czekać na blokadę.
    expect(statementsOf(tag)[0]).toBe(LOCK_TIMEOUT_STATEMENT);
  });

  it.each(guarded.map((e) => e.tag))("%s: bez statement_timeout", (tag) => {
    expect(statementsOf(tag).some((s) => /statement_timeout/i.test(s))).toBe(false);
  });
});

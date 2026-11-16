// @vitest-environment node
/**
 * #171: migracja 0009 (EXCLUDE + CHECK) — spójność pliku SQL, dziennika,
 * snapshotu i schematu. Bez bazy: snapshot liczy drizzle-kit/api ze schematu.
 * Działanie na prawdziwym Postgresie: __tests__/pg/appointment-overlap.pg.test.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_NO_OVERLAP_CONSTRAINT } from "@/lib/appointment-overlap";
import * as schema from "@/lib/schema";

const DRIZZLE = path.resolve(__dirname, "../../drizzle");
const TAG = "0009_appointments_no_overlap";
const read = (f: string) => readFileSync(path.join(DRIZZLE, f), "utf8");
const json = (f: string) => JSON.parse(read(f));

const sql = read(`${TAG}.sql`);
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").trim())
  .filter(Boolean);

describe("migracja 0009 — dziennik i snapshot", () => {
  const journal = json("meta/_journal.json") as { entries: { idx: number; tag: string; when: number }[] };
  const last = journal.entries.at(-1)!;
  const prev = journal.entries.at(-2)!;

  it("ostatni wpis dziennika to 0009, plik istnieje, `when` rośnie", () => {
    expect(last).toMatchObject({ idx: 9, tag: TAG });
    expect(existsSync(path.join(DRIZZLE, `${TAG}.sql`))).toBe(true);
    expect(last.when).toBeGreaterThan(prev.when);
  });

  it("snapshot 0009 następuje po 0008", () => {
    expect(json("meta/0009_snapshot.json").prevId).toBe(json("meta/0008_snapshot.json").id);
  });

  it("schemat == snapshot 0009 (żadnej zmiany schematu bez migracji)", () => {
    const fromSchema = generateDrizzleJson(schema as Record<string, unknown>) as { tables: unknown };
    expect(fromSchema.tables).toEqual(json("meta/0009_snapshot.json").tables);
  });

  it("CHECK w SQL to dokładnie to, co drizzle-kit generuje z różnicy 0008 → 0009", async () => {
    const generated = await generateMigration(json("meta/0008_snapshot.json"), json("meta/0009_snapshot.json"));
    expect(generated).toHaveLength(2);
    for (const stmt of generated) expect(statements).toContain(stmt.replace(/;$/, "") + ";");
  });
});

describe("migracja 0009 — EXCLUDE appointments_no_overlap", () => {
  const exclude = statements.find((s) => s.includes("EXCLUDE"));

  it("rozszerzenie btree_gist przed EXCLUDE", () => {
    const ext = statements.findIndex((s) => /CREATE EXTENSION IF NOT EXISTS btree_gist/.test(s));
    expect(ext).toBeGreaterThanOrEqual(0);
    expect(ext).toBeLessThan(statements.indexOf(exclude!));
  });

  it("ta sama reguła co appointmentConflictWhere: pracownik, [start, end), bez cancelled", () => {
    expect(exclude).toBe(
      `ALTER TABLE "appointments" ADD CONSTRAINT "${APPOINTMENT_NO_OVERLAP_CONSTRAINT}" EXCLUDE USING gist ` +
        `("employee_id" WITH =, tsrange("start_time", "end_time", '[)') WITH &&) WHERE ("status" <> 'cancelled');`
    );
  });

  it("sekcja ROLLBACK zdejmuje wszystkie trzy ograniczenia", () => {
    const rollback = sql.slice(sql.indexOf("-- ROLLBACK:"));
    for (const name of [APPOINTMENT_NO_OVERLAP_CONSTRAINT, "appointments_end_after_start", "time_blocks_end_after_start"]) {
      expect(rollback).toContain(`DROP CONSTRAINT "${name}"`);
    }
  });

  it("zapytanie kontrolne obok migracji: tylko odczyt, liczy oba CHECK i nakładające się pary", () => {
    const preflightFile = "checks/0009_appointments_no_overlap_preflight.sql";
    expect(sql).toContain(`drizzle/${preflightFile}`);
    const pre = read(preflightFile)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(pre).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i);
    // Dwa zapytania: podsumowanie (liczby) i lista szczegółowa — każde z kompletem warunków.
    const queries = pre.split(";").map((q) => q.trim()).filter(Boolean);
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(q).toContain("FROM appointments WHERE end_time <= start_time");
      expect(q).toContain("FROM time_blocks WHERE end_time <= start_time");
      // para nakładająca się = to samo, co odrzuci EXCLUDE: pracownik, [start, end), bez cancelled
      for (const cond of [
        "a.employee_id = b.employee_id",
        "a.status <> 'cancelled'",
        "b.status <> 'cancelled'",
        "a.start_time < b.end_time",
        "a.end_time > b.start_time",
      ]) {
        expect(q).toContain(cond);
      }
    }
  });

  it("zapytanie kontrolne nie jest w dzienniku migracji", () => {
    const journal = json("meta/_journal.json") as { entries: { tag: string }[] };
    expect(journal.entries.some((e) => e.tag.includes("preflight"))).toBe(false);
  });

  it("w pliku są tylko cztery polecenia (bez DROP/DELETE)", () => {
    expect(statements).toHaveLength(4);
    expect(statements.join("\n")).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
});

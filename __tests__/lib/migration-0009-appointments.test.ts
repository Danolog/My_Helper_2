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
const exclude = statements.find((s) => s.includes("EXCLUDE"));

describe("migracja 0009 — dziennik i snapshot", () => {
  const journal = json("meta/_journal.json") as { entries: { idx: number; tag: string; when: number }[] };
  const entry = journal.entries.find((e) => e.idx === 9);
  const prev = journal.entries.find((e) => e.idx === 8);
  const last = journal.entries.at(-1)!;

  it("wpis dziennika o idx 9 to 0009, plik istnieje, `when` rośnie", () => {
    expect(entry).toMatchObject({ idx: 9, tag: TAG });
    expect(existsSync(path.join(DRIZZLE, `${TAG}.sql`))).toBe(true);
    expect(entry!.when).toBeGreaterThan(prev!.when);
  });

  it("snapshot 0009 następuje po 0008", () => {
    expect(json("meta/0009_snapshot.json").prevId).toBe(json("meta/0008_snapshot.json").id);
  });

  it("schemat == snapshot ostatniego wpisu dziennika (żadnej zmiany schematu bez migracji)", () => {
    const fromSchema = generateDrizzleJson(schema as Record<string, unknown>) as { tables: unknown };
    const lastSnapshot = `meta/${String(last.idx).padStart(4, "0")}_snapshot.json`;
    expect(fromSchema.tables).toEqual(json(lastSnapshot).tables);
  });

  it("CHECK w SQL to dokładnie to, co drizzle-kit generuje z różnicy 0008 → 0009", async () => {
    const generated = await generateMigration(json("meta/0008_snapshot.json"), json("meta/0009_snapshot.json"));
    expect(generated).toHaveLength(2);
    for (const stmt of generated) expect(statements).toContain(stmt.replace(/;$/, "") + ";");
  });
});

describe("migracja 0009 — EXCLUDE appointments_no_overlap", () => {
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

  it("w pliku są tylko cztery polecenia (bez DROP/DELETE)", () => {
    expect(statements).toHaveLength(4);
    expect(statements.join("\n")).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
});

describe("zapytanie kontrolne scripts/sql/0009-precheck.sql", () => {
  const PRECHECK = "scripts/sql/0009-precheck.sql";
  const precheckPath = path.resolve(__dirname, "../..", PRECHECK);
  const queries = readFileSync(precheckPath, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((q) => q.trim())
    .filter(Boolean);
  const selects = queries.slice(1, -1);

  it("leży poza drizzle/ (migrator go nie podchwyci), migracja 0009 do niego odsyła", () => {
    expect(existsSync(precheckPath)).toBe(true);
    expect(sql).toContain(PRECHECK);
    expect(existsSync(path.join(DRIZZLE, "checks"))).toBe(false);
    const journal = json("meta/_journal.json") as { entries: { tag: string }[] };
    expect(journal.entries.some((e) => /precheck|preflight/.test(e.tag))).toBe(false);
  });

  it("transakcja READ ONLY: BEGIN READ ONLY na początku, ROLLBACK na końcu, pomiędzy same SELECT", () => {
    expect(queries[0]).toMatch(/^BEGIN\s+READ\s+ONLY$/i);
    expect(queries.at(-1)).toMatch(/^ROLLBACK$/i);
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const q of selects) expect(q).toMatch(/^SELECT\b/i);
    const body = selects.join("\n");
    expect(body).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|COPY|COMMIT|SET|CALL|DO|LOCK|VACUUM)\b/i
    );
    // jedyne BEGIN/ROLLBACK w pliku to te dwa na brzegach
    expect(queries.filter((q) => /\b(BEGIN|ROLLBACK)\b/i.test(q))).toHaveLength(2);
  });

  it("trzy liczniki z etykietami w pierwszym SELECT", () => {
    for (const label of [
      "AS appointments_check_violations",
      "AS time_blocks_check_violations",
      "AS overlapping_active_pairs",
    ]) {
      expect(selects[0]).toContain(label);
    }
  });

  it("warunki = zaprzeczenie reguł migracji (CHECK i EXCLUDE), w każdym SELECT", () => {
    // CHECK w migracji: end_time > start_time → naruszenie: end_time <= start_time
    for (const table of ["appointments", "time_blocks"]) {
      expect(statements).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_end_after_start" CHECK ("${table}"."end_time" > "${table}"."start_time");`
      );
    }
    // EXCLUDE w migracji: ten sam pracownik, '[)', bez cancelled → para: przedziały nachodzą (półotwarte)
    expect(exclude).toContain(`"employee_id" WITH =`);
    expect(exclude).toContain(`'[)'`);
    expect(exclude).toContain(`WHERE ("status" <> 'cancelled')`);
    for (const q of selects) {
      expect(q).toContain("FROM appointments WHERE end_time <= start_time");
      expect(q).toContain("FROM time_blocks WHERE end_time <= start_time");
      for (const cond of [
        "a.employee_id = b.employee_id",
        "a.id < b.id",
        "a.status <> 'cancelled'",
        "b.status <> 'cancelled'",
        "a.start_time < b.end_time",
        "a.end_time > b.start_time",
      ]) {
        expect(q).toContain(cond);
      }
      // styk nie jest kolizją: bez <= / >= w warunku pary
      expect(q).not.toMatch(/a\.start_time <= b\.end_time|a\.end_time >= b\.start_time/);
    }
  });
});

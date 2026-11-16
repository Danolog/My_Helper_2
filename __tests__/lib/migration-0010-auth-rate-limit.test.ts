// @vitest-environment node
/**
 * Migracja 0010 (tabela liczników limitu prób logowania) — spójność pliku SQL,
 * dziennika, snapshotu i schematu. Bez bazy: snapshot liczy drizzle-kit/api ze schematu.
 * Działanie i uprawnienia na prawdziwym Postgresie: __tests__/pg/auth-throttle.pg.test.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/schema";

const DRIZZLE = path.resolve(__dirname, "../../drizzle");
const TAG = "0010_auth_rate_limit";
const read = (f: string) => readFileSync(path.join(DRIZZLE, f), "utf8");
const json = (f: string) => JSON.parse(read(f));

const sql = read(`${TAG}.sql`);
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").trim())
  .filter(Boolean);

describe("migracja 0010 — dziennik i snapshot", () => {
  const journal = json("meta/_journal.json") as { entries: { idx: number; tag: string; when: number }[] };
  const last = journal.entries.at(-1)!;
  const prev = journal.entries.at(-2)!;

  it("ostatni wpis dziennika to 0010, plik istnieje, `when` rośnie", () => {
    expect(last).toMatchObject({ idx: 10, tag: TAG });
    expect(existsSync(path.join(DRIZZLE, `${TAG}.sql`))).toBe(true);
    expect(last.when).toBeGreaterThan(prev.when);
  });

  it("snapshot 0010 następuje po 0009", () => {
    expect(json("meta/0010_snapshot.json").prevId).toBe(json("meta/0009_snapshot.json").id);
  });

  it("schemat == snapshot 0010 (żadnej zmiany schematu bez migracji)", () => {
    const fromSchema = generateDrizzleJson(schema as Record<string, unknown>) as { tables: unknown };
    expect(fromSchema.tables).toEqual(json("meta/0010_snapshot.json").tables);
  });

  it("CREATE TABLE i CREATE INDEX w SQL to dokładnie to, co drizzle-kit generuje z różnicy 0009 → 0010", async () => {
    const generated = await generateMigration(json("meta/0009_snapshot.json"), json("meta/0010_snapshot.json"));
    expect(generated).toHaveLength(2);
    for (const stmt of generated) expect(statements).toContain(stmt.trim().replace(/;$/, "") + ";");
  });
});

describe("migracja 0010 — uprawnienia", () => {
  it("odbiera wszystkie prawa PUBLIC i roli żądań, jako ostatnie polecenie", () => {
    expect(statements.at(-1)).toBe(`REVOKE ALL ON "auth_rate_limit" FROM PUBLIC, myhelper_app;`);
  });

  it("trzy polecenia, bez GRANT, DROP, DELETE, TRUNCATE, UPDATE", () => {
    expect(statements).toHaveLength(3);
    expect(statements.join("\n")).not.toMatch(/\b(GRANT|DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
});

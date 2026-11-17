// @vitest-environment node
/**
 * #193 P5b: wyjście systemowe `seedDemoData` (`src/lib/server/system/seed.ts`).
 *
 * Pula systemowa to prawdziwy budowniczy drizzle (`pg-proxy`), który zapisuje
 * renderowany SQL i parametry; wiersze `RETURNING` podaje skrypt testu. Pula
 * żądań (`@/lib/db`) rzuca przy każdym użyciu.
 *
 * - `NODE_ENV=production` → odmowa, zero zapytań;
 * - cel nielokalny (Neon, host spoza listy, brak adresu) →
 *   odmowa z kodem strażnika, zero zapytań, bez adresu bazy w logu;
 * - cel lokalny poza produkcją → zapisy w kolejności: salon, 3 pracowników,
 *   5 usług, 3 klientki, 5 wizyt.
 */
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { appointments, clients, employees, salons, services } from "@/lib/schema";
// `vi.mock` jest wynoszone nad importy — wyjście dostaje atrapy obu pul.
import { seedDemoData } from "@/lib/server/system/seed";

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") return undefined;
        throw new Error(`wyjście systemowe użyło db (${String(p)}) zamiast dbSystem`);
      },
    }
  ),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sys = vi.hoisted(() => ({
  captured: [] as Array<{ sql: string; params: unknown[] }>,
  /** Wiersz RETURNING (tryb tablicowy pg-proxy) dla tabeli z zapytania. */
  returning: (_sql: string): unknown[][] => [],
}));

vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const dbSystem = drizzle(async (sql: string, params: unknown[]) => {
    sys.captured.push({ sql, params });
    return { rows: sys.returning(sql) };
  });
  return { dbSystem };
});

const LOCAL_URL = "postgresql://dev_user:dev_password@localhost:5432/pos_dev";
const NEON_URL = "postgresql://u:pw@neon.tech/db";
const OUTSIDE_HOST = "db.example.com";
const OUTSIDE_URL = `postgresql://u:p@${OUTSIDE_HOST}:5432/db`;

const TABLES: Table[] = [salons, employees, services, clients, appointments];

/** Wiersz RETURNING w kolejności kolumn tabeli: `id` z licznika, `baseDuration` usług = 60. */
function returningRow(table: Table, n: number): unknown[] {
  return Object.keys(getTableColumns(table)).map((c) => {
    if (c === "id") return `${getTableName(table)}-${n}`;
    if (c === "baseDuration") return 60;
    return null;
  });
}

const tableOf = (sql: string) => /^\s*insert into "([^"]+)"/i.exec(sql)?.[1] ?? null;

beforeEach(() => {
  sys.captured.length = 0;
  let n = 0;
  sys.returning = (sql) => {
    const name = tableOf(sql);
    const table = TABLES.find((t) => getTableName(t) === name);
    return table && name !== "appointments" ? [returningRow(table, ++n)] : [];
  };
  vi.mocked(logger.warn).mockClear();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("POSTGRES_URL", LOCAL_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("system/seed.ts: seedDemoData() — blokada celu przed pierwszym zapytaniem", () => {
  it("NODE_ENV=production → odmowa „production”, zero zapytań", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(seedDemoData()).resolves.toEqual({ ok: false, reason: "production" });
    expect(sys.captured).toEqual([]);
  });

  it.each([
    ["adres Neon", NEON_URL, "neon"],
    ["host spoza listy lokalnych", OUTSIDE_URL, "host_not_allowed"],
    ["brak adresu bazy", "", "missing_url"],
  ])("%s → odmowa z kodem strażnika, zero zapytań", async (_label, url, code) => {
    vi.stubEnv("POSTGRES_URL", url);
    await expect(seedDemoData()).resolves.toEqual({ ok: false, reason: code });
    expect(sys.captured).toEqual([]);
  });

  it("log odmowy zawiera tylko kod powodu — bez adresu, użytkownika i hasła", async () => {
    vi.stubEnv("POSTGRES_URL", NEON_URL);
    await seedDemoData();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).toContain("neon");
    expect(logged).not.toContain("neon.tech");
    expect(logged).not.toContain("u:pw");
    expect(logged).not.toContain("postgresql://");
  });
});

describe("system/seed.ts: seedDemoData() — zapisy na celu lokalnym", () => {
  it("kolejność tabel: salon, 3 pracowników, 5 usług, 3 klientki, 5 wizyt; wynik = liczności", async () => {
    const result = await seedDemoData();

    expect(result).toEqual({
      ok: true,
      data: { salon: "salons-1", employees: 3, services: 5, clients: 3, appointments: 5 },
    });
    expect(sys.captured.map((q) => tableOf(q.sql))).toEqual([
      "salons",
      ...Array(3).fill("employees"),
      ...Array(5).fill("services"),
      ...Array(3).fill("clients"),
      ...Array(5).fill("appointments"),
    ]);
  });

  it("salon demonstracyjny: stałe id, upsert po id z aktualizacją nazwy, RETURNING", async () => {
    await seedDemoData();
    const salon = sys.captured[0]!;
    expect(salon.params).toContain("00000000-0000-4000-8000-000000000001");
    expect(salon.params).toContain("Beauty Studio Demo");
    expect(salon.sql).toMatch(/on conflict \("id"\) do update set "name" = \$\d+/i);
    expect(salon.sql).toMatch(/returning/i);
  });

  it("wizyty wiążą pracownika, usługę i klientkę z wierszy RETURNING i salon demonstracyjny", async () => {
    await seedDemoData();
    const first = sys.captured.find((q) => tableOf(q.sql) === "appointments")!;
    expect(first.params).toEqual(
      expect.arrayContaining(["salons-1", "clients-10", "employees-2", "services-5", "scheduled"])
    );
  });

  it("brak wiersza RETURNING dla salonu → błąd, bez dalszych zapisów", async () => {
    sys.returning = () => [];
    await expect(seedDemoData()).rejects.toThrow("Failed to create salon");
    expect(sys.captured).toHaveLength(1);
  });

  it("błąd bazy przy pierwszym zapisie → propaguje", async () => {
    const { dbSystem } = await import("@/lib/server/system/db-system");
    const spy = vi.spyOn(dbSystem, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(seedDemoData()).rejects.toThrow("db down");
    spy.mockRestore();
  });
});

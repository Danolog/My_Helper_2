/**
 * Retencja tabel auth (`src/lib/server/system/auth-retention.ts`): renderowany
 * SQL partii i pętla partii, bez bazy.
 *
 * - Każda partia: osobna transakcja, najpierw `set local lock_timeout`, potem
 *   DELETE wierszy z podzapytania `expires_at < $cutoff` (ostro) z LIMIT i
 *   `FOR UPDATE SKIP LOCKED`.
 * - Jedna chwila odcięcia dla wszystkich partii obu tabel.
 * - Pętla kończy się na niepełnej partii albo na limicie partii (`complete: false`).
 * - Log: wyłącznie liczniki.
 *
 * Pula żądań (`@/lib/db`) rzuca przy każdym użyciu; pula systemowa podaje
 * budowniczego drizzle `pg-proxy`, który zapisuje SQL, a liczbę wierszy
 * RETURNING bierze ze skryptu testu. Zachowanie na bazie:
 * __tests__/pg/auth-retention.pg.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestPool = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`pula żądań użyta w ścieżce systemowej (db.${String(prop)})`);
        },
      }
    )
);
vi.mock("@/lib/db", () => ({ db: requestPool }));

const sys = vi.hoisted(() => ({
  captured: [] as Array<{ sql: string; params: unknown[]; tx: number }>,
  /** Kolejne liczby wierszy RETURNING dla DELETE danej tabeli. */
  deletes: { session: [] as number[], verification: [] as number[] },
  txCount: 0,
  transaction: vi.fn(),
}));
vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const tx = drizzle(async (sql: string, params: unknown[]) => {
    sys.captured.push({ sql, params, tx: sys.txCount });
    const table = /^delete from "(session|verification)"/.exec(sql)?.[1] as "session" | "verification" | undefined;
    const n = table ? (sys.deletes[table].shift() ?? 0) : 0;
    return { rows: Array.from({ length: n }, (_, i) => [`id-${i}`]) };
  });
  sys.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => {
    sys.txCount += 1;
    return fn(tx);
  });
  return { dbSystem: { transaction: sys.transaction } };
});

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

import { cleanupExpiredAuthRecords } from "@/lib/server/system/auth-retention";

const BATCH = 1000;
const MAX_BATCHES = 50;

beforeEach(() => {
  vi.clearAllMocks();
  sys.captured.length = 0;
  sys.deletes = { session: [], verification: [] };
  sys.txCount = 0;
});

const deletesOf = (table: string) => sys.captured.filter((c) => c.sql.startsWith(`delete from "${table}"`));

describe("cleanupExpiredAuthRecords: SQL partii", () => {
  it("lock_timeout jako pierwsze polecenie każdej transakcji, potem DELETE z podzapytaniem", async () => {
    await cleanupExpiredAuthRecords();

    // Pusta baza: jedna partia na tabelę.
    expect(sys.transaction).toHaveBeenCalledTimes(2);
    for (const tx of [1, 2]) {
      const stmts = sys.captured.filter((c) => c.tx === tx);
      expect(stmts).toHaveLength(2);
      expect(stmts[0]!.sql).toBe("set local lock_timeout = '5s'");
      expect(stmts[1]!.sql).toMatch(/^delete from "(session|verification)"/);
    }
  });

  it.each(["session", "verification"])(
    "%s: ostre expires_at < $cutoff, LIMIT partii i FOR UPDATE SKIP LOCKED",
    async (table) => {
      await cleanupExpiredAuthRecords();
      const [del] = deletesOf(table);
      expect(del).toBeDefined();
      const sql = del!.sql;
      expect(sql).toMatch(new RegExp(`where "${table}"\\."id" in \\(select "id" from "${table}" where "${table}"\\."expires_at" < \\$1 limit \\$2 for update skip locked\\)`));
      expect(sql).not.toMatch(/<=/);
      expect(del!.params[1]).toBe(BATCH);
    }
  );

  it("jedna chwila odcięcia dla wszystkich partii obu tabel", async () => {
    sys.deletes.session = [BATCH, 5];
    sys.deletes.verification = [BATCH, BATCH, 0];
    await cleanupExpiredAuthRecords();

    const cutoffs = [...deletesOf("session"), ...deletesOf("verification")].map((c) => c.params[0]);
    expect(cutoffs).toHaveLength(5);
    expect(new Set(cutoffs).size).toBe(1);
  });
});

describe("cleanupExpiredAuthRecords: pętla partii i liczniki", () => {
  it("pełne partie powtarza, niepełna kończy; liczniki = suma RETURNING", async () => {
    sys.deletes.session = [BATCH, BATCH, 3];
    sys.deletes.verification = [7];

    const result = await cleanupExpiredAuthRecords();

    expect(result).toEqual({ deletedSessions: 2 * BATCH + 3, deletedVerifications: 7, complete: true });
    expect(deletesOf("session")).toHaveLength(3);
    expect(deletesOf("verification")).toHaveLength(1);
  });

  it("partia równa BATCH, a następna pusta → jeszcze jedno zapytanie, potem koniec", async () => {
    sys.deletes.session = [BATCH, 0];
    const result = await cleanupExpiredAuthRecords();
    expect(result.deletedSessions).toBe(BATCH);
    expect(result.complete).toBe(true);
    expect(deletesOf("session")).toHaveLength(2);
  });

  it("limit partii: przerywa po MAX_BATCHES, complete: false, druga tabela nadal sprzątana", async () => {
    sys.deletes.session = Array.from({ length: MAX_BATCHES + 5 }, () => BATCH);
    sys.deletes.verification = [2];

    const result = await cleanupExpiredAuthRecords();

    expect(deletesOf("session")).toHaveLength(MAX_BATCHES);
    expect(result).toEqual({ deletedSessions: MAX_BATCHES * BATCH, deletedVerifications: 2, complete: false });
    expect(log.info).toHaveBeenCalledWith(expect.any(String), result);
  });

  it("nic do skasowania → zera, bez logu", async () => {
    const result = await cleanupExpiredAuthRecords();
    expect(result).toEqual({ deletedSessions: 0, deletedVerifications: 0, complete: true });
    expect(log.info).not.toHaveBeenCalled();
  });

  it("log zawiera wyłącznie liczniki (bez identyfikatorów usuniętych wierszy)", async () => {
    sys.deletes.session = [2];
    sys.deletes.verification = [1];
    await cleanupExpiredAuthRecords();

    expect(log.info).toHaveBeenCalledTimes(1);
    const meta = log.info.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["complete", "deletedSessions", "deletedVerifications"]);
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/id-\d/);
  });

  it("błąd bazy w partii → wyjątek do trasy (500), bez logu liczników", async () => {
    sys.transaction.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(cleanupExpiredAuthRecords()).rejects.toThrow("lock timeout");
    expect(log.info).not.toHaveBeenCalled();
  });
});

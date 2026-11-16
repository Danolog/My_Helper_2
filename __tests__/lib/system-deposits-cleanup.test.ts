/**
 * #193 P5a-2 — cron martwych rezerwacji z zadatkiem przeniesiony do
 * `src/lib/server/system/deposits-cleanup.ts` (plik zadatków: zapis
 * deposit_payments i anulowanie wizyt, recenzja także CTO).
 *
 * - Moduł ładowany dynamicznie (brak modułu = czerwień testów, nie błąd
 *   typecheck całego pliku); trasa woła wyjście z rejestru.
 * - Wybór i zmiana w jednym poleceniu: warunki strażników i progu sprawdzane
 *   na renderowanym SQL; liczniki = wiersze RETURNING (dokładne mapowanie).
 *   Zachowanie na bazie (niezmiennik, wyścig): __tests__/pg/deposits-cleanup.pg.test.ts.
 *
 * Pule są rozróżnione jawnie: `@/lib/db` (pula żądań) rzuca przy każdym użyciu,
 * `@/lib/server/system/db-system` to osobny fałszywy klient. Bramka
 * CRON_SECRET i komunikaty trasy bez zmian.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "../api/helpers";

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

// Pula systemowa: `transaction` podaje prawdziwy budowniczy drizzle (`pg-proxy`),
// który zapisuje renderowany SQL i parametry; wiersze RETURNING ze skryptu testu.
const sys = vi.hoisted(() => ({
  captured: [] as Array<{ sql: string; params: unknown[] }>,
  rows: [] as Array<[RegExp, unknown[][]]>,
  transaction: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const tx = drizzle(async (sql: string, params: unknown[]) => {
    sys.captured.push({ sql, params });
    const hit = sys.rows.find(([re]) => re.test(sql));
    return { rows: hit ? hit[1] : [] };
  });
  sys.transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
  return { dbSystem: { select: sys.select, transaction: sys.transaction } };
});

const registry = vi.hoisted(() => ({ cleanupStaleDepositBookings: vi.fn() }));
vi.mock("@/lib/server/system", () => registry);

// Bramka CRON_SECRET (auth-middleware) zostaje prawdziwa; moduł sesji bez adaptera.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { GET, POST } from "@/app/api/cron/cleanup-pending-deposits/route";

const MODULE = path.resolve(__dirname, "../../src/lib/server/system/deposits-cleanup.ts");
type Cleanup = () => Promise<{ cancelledAppointments: number; failedPayments: number }>;
async function loadCleanup(): Promise<Cleanup> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  expect(typeof mod.cleanupStaleDepositBookings, "eksport cleanupStaleDepositBookings").toBe("function");
  return mod.cleanupStaleDepositBookings as Cleanup;
}

const SECRET = "test-cron-secret";
const CRON_URL = "http://localhost/api/cron/cleanup-pending-deposits";
const cronRequest = (method: "GET" | "POST", secret: string | null = SECRET) =>
  createMockRequest(CRON_URL,{ method, headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  sys.captured.length = 0;
  sys.rows = [];
});

/** Parametr `$n` stojący po `fragment` w SQL zapytania. */
function paramAfter(q: { sql: string; params: unknown[] }, fragment: string): unknown {
  const i = q.sql.indexOf(fragment);
  expect(i, `${fragment} w: ${q.sql}`).toBeGreaterThanOrEqual(0);
  const m = /^\$(\d+)/.exec(q.sql.slice(i + fragment.length));
  expect(m, `parametr po ${fragment}`).not.toBeNull();
  return q.params[Number(m![1]) - 1];
}

describe("system/deposits-cleanup.ts: cleanupStaleDepositBookings (P5a)", () => {
  it("jedna transakcja na dbSystem, dwa polecenia: najpierw płatności, potem wizyty; bez osobnego odczytu", async () => {
    const cleanup = await loadCleanup();
    await cleanup();
    expect(sys.transaction).toHaveBeenCalledTimes(1);
    expect(sys.select).not.toHaveBeenCalled();
    expect(sys.captured.map((q) => q.sql.slice(0, 30))).toEqual([
      expect.stringMatching(/^update "deposit_payments" set/),
      expect.stringMatching(/^update "appointments" set/),
    ]);
  });

  it("liczniki = wiersze RETURNING obu poleceń (dokładne mapowanie)", async () => {
    sys.rows = [
      [/^update "deposit_payments"/, [["p1"]]],
      [/^update "appointments"/, [["a1"], ["a2"]]],
    ];
    const cleanup = await loadCleanup();
    await expect(cleanup()).resolves.toEqual({ cancelledAppointments: 2, failedPayments: 1 });
  });

  it("nic nie zmienione → 0 i 0", async () => {
    const cleanup = await loadCleanup();
    await expect(cleanup()).resolves.toEqual({ cancelledAppointments: 0, failedPayments: 0 });
  });

  it("polecenie płatności: strażnik pending, wiek, wizyta scheduled bez wpłaty i bez żywej płatności", async () => {
    const cleanup = await loadCleanup();
    await cleanup();
    const q = sys.captured[0]!;
    expect(q.sql).toMatch(/set "status" = \$1/);
    expect(q.params[0]).toBe("failed");
    expect(paramAfter(q, `"deposit_payments"."status" = `)).toBe("pending");
    expect(q.sql).toContain(`"deposit_payments"."created_at" < $`);
    expect(paramAfter(q, `"appointments"."status" = `)).toBe("scheduled");
    expect(paramAfter(q, `"appointments"."deposit_paid" = `)).toBe(false);
    expect(q.sql).toMatch(/not exists \(select 1 from "deposit_payments" "other_payment"/);
    expect(q.sql).toContain(`"other_payment"."appointment_id" = "appointments"."id"`);
    expect(q.sql).toContain(`"other_payment"."created_at" >= $`);
    expect(q.sql).toMatch(/"other_payment"\."status" not in \(\$\d+, \$\d+\)/);
    expect(q.sql).toMatch(/returning "id"$/);
  });

  it("polecenie wizyt: scheduled, bez wpłaty, istnieje płatność, brak żywej (status <> failed albo młodsza)", async () => {
    const cleanup = await loadCleanup();
    await cleanup();
    const q = sys.captured[1]!;
    expect(paramAfter(q, `"appointments"."status" = `)).toBe("scheduled");
    expect(paramAfter(q, `"appointments"."deposit_paid" = `)).toBe(false);
    expect(q.sql).toContain(`and exists (select 1 from "deposit_payments" where "deposit_payments"."appointment_id" = "appointments"."id")`);
    expect(q.sql).toContain(`not exists (select 1 from "deposit_payments" "other_payment"`);
    expect(paramAfter(q, `"other_payment"."status" <> `)).toBe("failed");
    expect(q.sql).toContain(`"other_payment"."created_at" >= $`);
    expect(q.sql).toMatch(/returning "id"$/);
  });

  it("ten sam próg w obu poleceniach (45 min)", async () => {
    const before = Date.now();
    const cleanup = await loadCleanup();
    await cleanup();
    const cutoffs = [
      paramAfter(sys.captured[0]!, `"deposit_payments"."created_at" < `),
      paramAfter(sys.captured[0]!, `"other_payment"."created_at" >= `),
      paramAfter(sys.captured[1]!, `"other_payment"."created_at" >= `),
    ].map((v) => new Date(v as string).getTime());
    expect(new Set(cutoffs).size).toBe(1);
    expect(Math.abs(before - 45 * 60_000 - cutoffs[0]!)).toBeLessThan(5_000);
  });
});

describe("trasa /api/cron/cleanup-pending-deposits woła wyjście z rejestru (P5a)", () => {
  it.each(["GET", "POST"] as const)("%s z sekretem → 200 z licznikami z rejestru, bez puli żądań", async (method) => {
    registry.cleanupStaleDepositBookings.mockResolvedValue({ cancelledAppointments: 2, failedPayments: 1 });
    const handler = method === "GET" ? GET : POST;
    const { status, body: data } = await parseResponse(await handler(cronRequest(method)));
    expect(status).toBe(200);
    expect(data).toMatchObject({ success: true, cancelledAppointments: 2, failedPayments: 1 });
    expect(registry.cleanupStaleDepositBookings).toHaveBeenCalledTimes(1);
  });

  it("zero martwych → 200 z dotychczasowym komunikatem", async () => {
    registry.cleanupStaleDepositBookings.mockResolvedValue({ cancelledAppointments: 0, failedPayments: 0 });
    const { status, body: data } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(data).toMatchObject({ success: true, cancelledAppointments: 0, failedPayments: 0 });
  });

  it("błąd wyjścia systemowego → 500 z dotychczasowym komunikatem", async () => {
    registry.cleanupStaleDepositBookings.mockRejectedValue(new Error("boom"));
    const { status, body: data } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(data).toMatchObject({ success: false, error: "Nie udalo sie wyczyscic nieoplaconych zadatkow" });
    expect(registry.cleanupStaleDepositBookings).toHaveBeenCalledTimes(1);
  });

  it("bez CRON_SECRET → 500 przed wyjściem systemowym (fail-closed bez zmian)", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(registry.cleanupStaleDepositBookings).not.toHaveBeenCalled();
  });

  it("zły token → 401 przed wyjściem systemowym", async () => {
    const { status } = await parseResponse(await POST(cronRequest("POST", "zly")));
    expect(status).toBe(401);
    expect(registry.cleanupStaleDepositBookings).not.toHaveBeenCalled();
  });
});

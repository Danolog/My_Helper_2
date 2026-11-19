/**
 * `GET /api/subscriptions/expiration-warning` — odpowiedzi 401, 404, 200
 * z danymi aktywnej subskrypcji, 200 z `data: null` i 500.
 *
 * Atrapa `db` zapisuje tabelę (`notifications` albo inna) i warunek `where`
 * każdego zapytania oraz wpisy `select:…`, a w `transaction` — `begin`,
 * `execute:…` (SQL i parametry), `commit` albo `rollback`. Moduł
 * `@/lib/server/repository` nie jest podmieniany: trasa woła prawdziwe
 * `forSalon`, które otwiera transakcję na atrapie.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/expiration-warning/route";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const { notifications } = await import("@/lib/schema");
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const dialect = new Dialect();

  type Query = { table: string; where?: unknown };
  type Resolve = (r: unknown) => unknown;
  type Reject = (e: unknown) => unknown;
  const state = {
    queries: [] as Query[],
    log: [] as string[],
    subscriptionRows: [] as unknown[],
    failSelect: null as Error | null,
  };

  function selectChain() {
    const q: Query = { table: "?" };
    const chain: Record<string, unknown> = {};
    chain.from = (t: unknown) => {
      q.table = t === notifications ? "notifications" : "other";
      return chain;
    };
    chain.innerJoin = () => chain;
    chain.where = (w: unknown) => {
      q.where = w;
      return chain;
    };
    chain.then = (resolve: Resolve, reject?: Reject) => {
      state.queries.push(q);
      state.log.push(`select:${q.table}`);
      if (state.failSelect) return Promise.reject(state.failSelect).then(resolve, reject);
      const rows = q.table === "notifications" ? [] : state.subscriptionRows;
      return Promise.resolve(rows).then(resolve, reject);
    };
    return chain;
  }

  const db = {
    select: () => selectChain(),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      state.log.push("begin");
      const tx = {
        select: () => selectChain(),
        execute: async (s: SQL) => {
          const { sql, params } = dialect.sqlToQuery(s);
          state.log.push(`execute:${sql} ${JSON.stringify(params)}`);
          return [];
        },
      };
      try {
        const result = await fn(tx);
        state.log.push("commit");
        return result;
      } catch (e) {
        state.log.push("rollback");
        throw e;
      }
    },
  };

  function reset() {
    state.queries.length = 0;
    state.log.length = 0;
    state.subscriptionRows = [];
    state.failSelect = null;
  }

  return { db, dialect, state, reset };
});

const { mockRequireAuth, mockGetUserSalonId } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetUserSalonId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00" };
const ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: PLAN_PRO.id,
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000),
};

const APP_ROLE = process.env.MYHELPER_APP_DB_ROLE ?? "myhelper_app";
const SET_ROLE = `execute:set local role ${APP_ROLE} []`;
const setConfig = (salonId: string) =>
  `execute:select set_config('app.current_salon_id', $1, true) ${JSON.stringify([salonId])}`;

const warningsQuery = () => h.state.queries.find((q) => q.table === "notifications");

async function callGet() {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reset();
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockGetUserSalonId.mockResolvedValue("salon-1");
  h.state.subscriptionRows = [{ subscription: ACTIVE, plan: PLAN_PRO }];
});

describe("GET /api/subscriptions/expiration-warning — odpowiedzi", () => {
  it("requireAuth zwraca odpowiedź 401 → trasa zwraca 401 bez zapytań do bazy", async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    expect((await callGet()).status).toBe(401);
    expect(h.state.log).toEqual([]);
  });

  it("getUserSalonId zwraca null → 404 „Salon not found” bez zapytań do bazy", async () => {
    mockGetUserSalonId.mockResolvedValueOnce(null);

    const { status, body } = await callGet();

    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon not found" });
    expect(h.state.log).toEqual([]);
  });

  it("aktywna subskrypcja → 200: data ma dokładnie klucze subscriptionId, planName, planSlug, status, currentPeriodEnd, daysRemaining, warningThreshold, isNearExpiry, renewalAmount; żadne zapytanie do notifications; log atrapy to dokładnie begin, set local role roli aplikacji, set_config z salon-1, select:other, commit", async () => {
    const { status, body } = await callGet();

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(
      [
        "subscriptionId",
        "planName",
        "planSlug",
        "status",
        "currentPeriodEnd",
        "daysRemaining",
        "warningThreshold",
        "isNearExpiry",
        "renewalAmount",
      ].sort(),
    );
    expect(h.state.queries.filter((q) => q.table === "notifications")).toEqual([]);
    expect(h.state.log).toEqual(["begin", SET_ROLE, setConfig("salon-1"), "select:other", "commit"]);
  });

  it("salon-2 w sesji → 200, log atrapy zawiera set_config z salon-2, a parametry warunku where zapytania o subskrypcję zawierają salon-2 i nie zawierają salon-1", async () => {
    mockGetUserSalonId.mockResolvedValueOnce("salon-2");

    expect((await callGet()).status).toBe(200);
    expect(h.state.log).toContain(setConfig("salon-2"));
    const subscriptionQuery = h.state.queries.find((q) => q.table === "other");
    const { params } = h.dialect.sqlToQuery(subscriptionQuery!.where as SQL);
    expect(params).toContain("salon-2");
    expect(params).not.toContain("salon-1");
  });

  it("brak aktywnej subskrypcji → 200 z data: null i bez zapytania do notifications", async () => {
    h.state.subscriptionRows = [];

    const { status, body } = await callGet();

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: null, message: "Brak aktywnej subskrypcji" });
    expect(warningsQuery()).toBeUndefined();
  });

  it("zapytanie o aktywną subskrypcję kończy się błędem → 500 z komunikatem o nieudanym sprawdzeniu; log atrapy kończy się wpisem rollback i nie zawiera commit", async () => {
    h.state.failSelect = new Error("connection lost");

    const { status, body } = await callGet();

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Nie udalo sie sprawdzic statusu wygasniecia" });
    expect(h.state.log.at(-1)).toBe("rollback");
    expect(h.state.log).not.toContain("commit");
  });
});

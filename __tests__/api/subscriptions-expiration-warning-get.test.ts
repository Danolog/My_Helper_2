/**
 * `GET /api/subscriptions/expiration-warning` — odczyt ostatnich ostrzeżeń
 * o wygaśnięciu: warunek salonu z sesji ORAZ alternatywa trzech wzorców treści.
 *
 * Atrapa `db` zapisuje argumenty `where`, `orderBy` i `limit` każdego zapytania;
 * warunek renderowany do SQL prawdziwym `PgDialect` (bez bazy).
 */
import { NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/expiration-warning/route";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const { notifications } = await import("@/lib/schema");
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const dialect = new Dialect();

  type Query = { table: string; where?: unknown; orderBy: unknown[]; limit?: number };
  type Resolve = (r: unknown) => unknown;
  type Reject = (e: unknown) => unknown;
  const state = {
    queries: [] as Query[],
    log: [] as string[],
    subscriptionRows: [] as unknown[],
    warningRows: [] as unknown[],
    failSelect: null as Error | null,
  };

  function selectChain() {
    const q: Query = { table: "?", orderBy: [] };
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
    chain.orderBy = (...o: unknown[]) => {
      q.orderBy = o;
      return chain;
    };
    chain.limit = (n: number) => {
      q.limit = n;
      return chain;
    };
    chain.then = (resolve: Resolve, reject?: Reject) => {
      state.queries.push(q);
      state.log.push(`select:${q.table}`);
      if (state.failSelect) return Promise.reject(state.failSelect).then(resolve, reject);
      const rows = q.table === "notifications" ? state.warningRows : state.subscriptionRows;
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
    state.warningRows = [];
    state.failSelect = null;
  }

  return { db, state, reset };
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

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL);

const PLAN_PRO = { id: "plan-pro", name: "Pro", slug: "pro", priceMonthly: "149.00" };
const ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: PLAN_PRO.id,
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000),
};
const SENT_AT = new Date("2026-11-10T08:00:00.000Z");
const CREATED_AT = new Date("2026-11-10T08:00:01.000Z");
const WARNING_ROW = {
  id: "n-1",
  salonId: "salon-1",
  clientId: null,
  type: "email",
  message: "Twoja subskrypcja planu Pro wygasa za 3 dni",
  status: "sent",
  sentAt: SENT_AT,
  createdAt: CREATED_AT,
};

const WARNINGS_WHERE_SQL =
  '("notifications"."salon_id" = $1 and (' +
  '"notifications"."message" like $2 or "notifications"."message" like $3 or "notifications"."message" like $4))';

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
  h.state.warningRows = [WARNING_ROW];
});

describe("GET /api/subscriptions/expiration-warning — zapytanie o ostatnie ostrzeżenia", () => {
  it("warunek zapytania do notifications wyrenderowany do SQL: salon = $1 and (trzy wzorce like połączone or, w nawiasie); parametry: salon z sesji i trzy wzorce", async () => {
    await callGet();

    const q = render(warningsQuery()?.where);
    expect(q.sql).toBe(WARNINGS_WHERE_SQL);
    expect(q.params).toEqual(["salon-1", "%wygasa%", "%odnowienia%", "%expir%"]);
  });

  it("inny salon w sesji → jego identyfikator jest parametrem warunku salonu i kontekstu transakcji", async () => {
    mockGetUserSalonId.mockResolvedValue("salon-2");

    await callGet();

    const q = render(warningsQuery()?.where);
    expect(q.sql).toBe(WARNINGS_WHERE_SQL);
    expect(q.params[0]).toBe("salon-2");
    expect(q.params).not.toContain("salon-1");
    expect(h.state.log).toContainEqual(expect.stringMatching(/^execute:select set_config\('app\.current_salon_id', \$1, true\) \["salon-2"\]$/));
  });

  it("zapytanie do notifications biegnie w transakcji po przełączeniu roli i ustawieniu kontekstu salonu z sesji", async () => {
    await callGet();

    expect(h.state.log).toEqual([
      "select:other",
      "begin",
      expect.stringMatching(/^execute:set local role [a-z_][a-z0-9_]* \[\]$/),
      'execute:select set_config(\'app.current_salon_id\', $1, true) ["salon-1"]',
      "select:notifications",
      "commit",
    ]);
  });

  it("200: odpowiedź mapuje wiersze atrapy na id, type, message, status, sentAt, createdAt; zapytanie ma limit 5 i sortowanie malejąco po created_at", async () => {
    const { status, body } = await callGet();

    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.recentWarnings).toEqual([
      {
        id: "n-1",
        type: "email",
        message: WARNING_ROW.message,
        status: "sent",
        sentAt: SENT_AT.toISOString(),
        createdAt: CREATED_AT.toISOString(),
      },
    ]);
    const q = warningsQuery();
    expect(q?.limit).toBe(5);
    expect(q?.orderBy).toHaveLength(1);
    expect(render(q?.orderBy[0]).sql).toMatch(/^"notifications"\."created_at" desc$/i);
  });
});

describe("GET /api/subscriptions/expiration-warning — odpowiedzi poza ścieżką ostrzeżeń", () => {
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

  it("brak aktywnej subskrypcji → 200 z data: null i bez zapytania do notifications", async () => {
    h.state.subscriptionRows = [];

    const { status, body } = await callGet();

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: null, message: "Brak aktywnej subskrypcji" });
    expect(warningsQuery()).toBeUndefined();
  });

  it("zapytanie o aktywną subskrypcję kończy się błędem → 500 z komunikatem o nieudanym sprawdzeniu", async () => {
    h.state.failSelect = new Error("connection lost");

    const { status, body } = await callGet();

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Nie udalo sie sprawdzic statusu wygasniecia" });
  });
});

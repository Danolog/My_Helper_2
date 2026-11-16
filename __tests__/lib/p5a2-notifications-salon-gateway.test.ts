/**
 * #193 P5a-2, decyzja CTO D1: `notifications/{birthday,low-stock,we-miss-you}`
 * działają na jednym salonie z obowiązkowym `salonId` (wołający z sekretem
 * crona), więc idą przez `forSalon(salonId)`, nie przez pulę `db` ani `system/`.
 *
 * Warunki D1, które ten plik sprawdza:
 * 1. brak `salonId` albo wartość niebędąca UUID → 400 przed jakimkolwiek
 *    zapytaniem (sekret crona sprawdzany przed tym, bez zmian);
 * 2. każde zapytanie w `raw` ma jawny warunek salonu, także w złączeniach
 *    i podzapytaniach (kontrakt `raw()` w `repository.ts`): test na
 *    renderowanym SQL — dla każdej tabeli z `salon_id` w FROM/JOIN warunek
 *    `"<tabela>"."salon_id" = $n` z parametrem równym salonowi bramy, dla
 *    `salons` warunek `"salons"."id" = $n`; insert notyfikacji z salonem bramy.
 *
 * Brama jest prawdziwym budowniczym zapytań drizzle (`pg-proxy`), który zamiast
 * bazy zapisuje SQL i parametry. Pula `db` i `dbSystem` rzucają przy użyciu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "../api/helpers";

type Captured = { sql: string; params: unknown[]; gateSalonId: string };

const h = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`${name} użyte w trasie salonu (${String(prop)})`);
        },
      }
    );
  return {
    throwingPool,
    captured: [] as Captured[],
    gateSalonIds: [] as string[],
    currentGate: null as string | null,
    /** Odpowiedzi bazy: pierwsza reguła, której wzorzec pasuje do SQL. */
    rows: [] as Array<[RegExp, unknown[][]]>,
    isProPlan: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: h.throwingPool("db") }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.throwingPool("dbSystem") }));
vi.mock("@/lib/server/system", () => h.throwingPool("rejestr system/"));
vi.mock("@/lib/server/repository", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const tx = drizzle(async (sql: string, params: unknown[]) => {
    h.captured.push({ sql, params, gateSalonId: h.currentGate ?? "<poza bramą>" });
    const hit = h.rows.find(([re]) => re.test(sql));
    return { rows: hit ? hit[1] : [] };
  });
  return {
    forSalon: (salonId: string) => ({
      salonId,
      raw: async (fn: (t: unknown) => unknown) => {
        h.gateSalonIds.push(salonId);
        const prev = h.currentGate;
        h.currentGate = salonId;
        try {
          return await fn(tx);
        } finally {
          h.currentGate = prev;
        }
      },
    }),
  };
});
vi.mock("@/lib/subscription", () => ({ isProPlan: (...a: unknown[]) => h.isProPlan(...a) }));
// Bramka CRON_SECRET (auth-middleware) zostaje prawdziwa; moduł sesji bez adaptera.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import * as birthday from "@/app/api/notifications/birthday/route";
import * as lowStock from "@/app/api/notifications/low-stock/route";
import * as weMissYou from "@/app/api/notifications/we-miss-you/route";

const SALON_A = "00000000-0000-4000-8000-00000000000a";
const PRODUCT = "00000000-0000-4000-8000-0000000000f1";
const SECRET = "test-cron-secret";

/** Tabele z kolumną salon_id, które czytają albo piszą te trasy. */
const SALON_TABLES = ["clients", "appointments", "notifications", "products"];

const req = (path: string, method: "GET" | "POST", body?: unknown, secret: string | null = SECRET) =>
  createMockRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body } : {}),
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

/** Numery parametrów `$n`, przy których stoi dany warunek równości. */
function eqParams(sql: string, column: string): number[] {
  const re = new RegExp(`${column.replace(/[."]/g, (c) => `\\${c}`)} = \\$(\\d+)`, "g");
  return [...sql.matchAll(re)].map((m) => Number(m[1]));
}

/**
 * Każde zapytanie: wykonane w bramie salonu, a każda tabela salonu z FROM/JOIN
 * ma jawny warunek salonu z parametrem równym salonowi bramy.
 */
function expectSalonScoped(salon: string) {
  expect(h.captured.length, "zapytania przez bramę").toBeGreaterThan(0);
  for (const q of h.captured) {
    expect(q.gateSalonId, q.sql).toBe(salon);
    if (/^insert into "notifications"/.test(q.sql)) {
      expect(q.params, q.sql).toContain(salon);
      continue;
    }
    const tables = new Set([...q.sql.matchAll(/(?:from|join)\s+"(\w+)"/g)].map((m) => m[1]!));
    for (const t of tables) {
      if (SALON_TABLES.includes(t)) {
        const ns = eqParams(q.sql, `"${t}"."salon_id"`);
        expect(ns.some((n) => q.params[n - 1] === salon), `brak "${t}"."salon_id" = salon w: ${q.sql}`).toBe(true);
      } else if (t === "salons") {
        const ns = eqParams(q.sql, `"salons"."id"`);
        expect(ns.some((n) => q.params[n - 1] === salon), `brak "salons"."id" = salon w: ${q.sql}`).toBe(true);
      }
    }
  }
}

const today = new Date();
const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.captured.length = 0;
  h.gateSalonIds.length = 0;
  h.currentGate = null;
  h.rows = [];
  h.isProPlan.mockResolvedValue(false);
});

describe("400/401 przed jakimkolwiek zapytaniem (D1 pkt 1)", () => {
  const cases: Array<[string, () => Promise<Response>, number]> = [
    ["birthday GET bez salonId", () => birthday.GET(req("/api/notifications/birthday", "GET")), 400],
    ["birthday GET salonId nie-UUID", () => birthday.GET(req("/api/notifications/birthday?salonId=abc", "GET")), 400],
    ["birthday POST salonId nie-UUID", () => birthday.POST(req("/api/notifications/birthday", "POST", { salonId: "abc" })), 400],
    ["birthday POST bez sekretu", () => birthday.POST(req("/api/notifications/birthday", "POST", { salonId: SALON_A }, null)), 401],
    ["low-stock GET bez salonId", () => lowStock.GET(req("/api/notifications/low-stock", "GET")), 400],
    ["low-stock GET salonId nie-UUID", () => lowStock.GET(req("/api/notifications/low-stock?salonId=abc", "GET")), 400],
    ["low-stock POST salonId nie-UUID", () => lowStock.POST(req("/api/notifications/low-stock", "POST", { salonId: "abc", productId: PRODUCT, productName: "X" })), 400],
    ["low-stock GET bez sekretu", () => lowStock.GET(req(`/api/notifications/low-stock?salonId=${SALON_A}`, "GET", undefined, null)), 401],
    ["we-miss-you GET bez salonId", () => weMissYou.GET(req("/api/notifications/we-miss-you", "GET")), 400],
    ["we-miss-you GET salonId nie-UUID", () => weMissYou.GET(req("/api/notifications/we-miss-you?salonId=abc", "GET")), 400],
    ["we-miss-you POST salonId nie-UUID", () => weMissYou.POST(req("/api/notifications/we-miss-you", "POST", { salonId: "abc" })), 400],
    ["we-miss-you POST bez sekretu", () => weMissYou.POST(req("/api/notifications/we-miss-you", "POST", { salonId: SALON_A }, null)), 401],
  ];
  it.each(cases)("%s → %i, brama nieużyta", async (_n, call, status) => {
    const res = await call();
    expect(res.status).toBe(status);
    expect(h.gateSalonIds).toEqual([]);
    expect(h.captured).toEqual([]);
  });
});

describe("jawny warunek salonu w każdym zapytaniu bramy (D1 pkt 2)", () => {
  it("birthday GET: salon i klienci z warunkiem salonu", async () => {
    const { status } = await parseResponse(await birthday.GET(req(`/api/notifications/birthday?salonId=${SALON_A}`, "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(2);
    expectSalonScoped(SALON_A);
  });

  it("birthday POST: salon, klienci, notyfikacje z dziś i insert — wszystko w salonie bramy", async () => {
    h.rows = [
      [/from "salons"/, [["Salon A", {}]]],
      [/from "clients"/, [["c-1", "Ala", "Nowak", "+48500100200", null, `1990-${mmdd}`]]],
    ];
    const { status, body } = await parseResponse(
      await birthday.POST(req("/api/notifications/birthday", "POST", { salonId: SALON_A }))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured.map((q) => q.sql.split(" ").slice(0, 2).join(" "))).toEqual([
      "select \"name\",",
      "select \"id\",",
      "select \"client_id\"",
      "insert into",
    ]);
    expectSalonScoped(SALON_A);
  });

  it("low-stock GET: produkty z warunkiem salonu", async () => {
    const { status } = await parseResponse(await lowStock.GET(req(`/api/notifications/low-stock?salonId=${SALON_A}`, "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(1);
    expectSalonScoped(SALON_A);
  });

  it("low-stock POST: sprawdzenie duplikatu i insert w salonie bramy", async () => {
    const { status, body } = await parseResponse(
      await lowStock.POST(
        req("/api/notifications/low-stock", "POST", { salonId: SALON_A, productId: PRODUCT, productName: "Szampon", quantity: 1, minQuantity: 3 })
      )
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(2);
    expect(h.captured[1]!.sql).toMatch(/^insert into "notifications"/);
    expectSalonScoped(SALON_A);
  });

  it("we-miss-you GET: salon i nieaktywni klienci (podzapytanie wizyt z warunkiem salonu)", async () => {
    const { status } = await parseResponse(await weMissYou.GET(req(`/api/notifications/we-miss-you?salonId=${SALON_A}`, "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(2);
    expect(h.captured[1]!.sql).toMatch(/from "appointments"/);
    expectSalonScoped(SALON_A);
  });

  it("we-miss-you POST: salon, nieaktywni, ostatnie notyfikacje i insert — wszystko w salonie bramy", async () => {
    h.rows = [
      [/from "salons"/, [["Salon A", {}]]],
      [/from "clients"/, [["c-1", "Ala", "Nowak", null, "ala@example.com", "2020-01-01 00:00:00", null]]],
    ];
    const { status, body } = await parseResponse(
      await weMissYou.POST(req("/api/notifications/we-miss-you", "POST", { salonId: SALON_A }))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(4);
    expect(h.captured[3]!.sql).toMatch(/^insert into "notifications"/);
    expectSalonScoped(SALON_A);
  });
});

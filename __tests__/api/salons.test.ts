/**
 * P0 · /api/salons — mutacje korzenia najemcy (tabela `salons`).
 *
 * DELETE: przed poprawką każde zalogowane konto (także klient) usuwało dowolny
 * salon po id, a 26 FK do salons.id ma ON DELETE CASCADE (klienci, wizyty,
 * subskrypcje). Trasa nie ma wołającego w UI — zdjęta. Test sprawdza zachowanie
 * HTTP: metoda nieeksportowana => Next.js odpowiada 405, a żaden salon nie
 * znika — niezależnie od tego, kto pyta.
 *
 * Baza to atrapa w pamięci: `eq`/`and` z drizzle-orm budują predykaty, które
 * atrapa naprawdę stosuje do wierszy. Dzięki temu test łapie brak warunku
 * właściciela w WHERE, a nie tylko „czy zawołano db.delete”.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as route from "@/app/api/salons/route";
import { createMockRequest } from "./helpers";

// -------------------------------------------------------
// Atrapa bazy w pamięci
// -------------------------------------------------------

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;

const store: { salons: Row[] } = { salons: [] };

vi.mock("drizzle-orm", () => {
  const col = (c: unknown) => String(c).split(".")[1]!;
  return {
    eq: (c: unknown, v: unknown): Pred => (row) => row[col(c)] === v,
    and: (...ps: Pred[]): Pred => (row) => ps.every((p) => p(row)),
    ne: (c: unknown, v: unknown): Pred => (row) => row[col(c)] !== v,
    isNotNull: (c: unknown): Pred => (row) => row[col(c)] != null,
    inArray: (c: unknown, vs: unknown[]): Pred => (row) => vs.includes(row[col(c)]),
    count: vi.fn(),
    avg: vi.fn(),
  };
});

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) });
  return { salons: table("salons"), services: table("services"), reviews: table("reviews") };
});

let nextId = 1;
vi.mock("@/lib/db", () => ({
  db: {
    delete: () => ({
      where: (pred: Pred) => ({
        returning: async () => {
          const removed = store.salons.filter(pred);
          store.salons = store.salons.filter((r) => !pred(r));
          return removed;
        },
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        returning: async () => {
          const row = { id: `new-salon-${nextId++}`, ...v };
          store.salons.push(row);
          return [row];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (pred: Pred) => {
          const rows = () => store.salons.filter(pred);
          return Object.assign(Promise.resolve(rows()), {
            limit: async (n: number) => rows().slice(0, n),
          });
        },
      }),
    }),
  },
}));

// Sesja: null => brak logowania (401), inaczej konto o danym id.
let sessionUserId: string | null = null;
vi.mock("@/lib/auth-middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAuth: async () =>
      sessionUserId === null
        ? NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
        : { user: { id: sessionUserId }, session: {} },
    isAuthError: (r: unknown) => r instanceof NextResponse,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// -------------------------------------------------------
// Dane
// -------------------------------------------------------

const OWNER_A = "user-owner-a";
const OWNER_B = "user-owner-b";
const CLIENT = "user-client-no-salon";
const SALON_A = "salon-a";
const SALON_B = "salon-b";

/** Odpowiednik routera Next.js: metoda bez eksportu => 405. */
async function callDelete(id?: string): Promise<number> {
  const handler = (route as Record<string, unknown>).DELETE as
    | ((req: Request) => Promise<Response>)
    | undefined;
  if (!handler) return 405;
  const url = id ? `http://localhost/api/salons?id=${id}` : "http://localhost/api/salons";
  const res = await handler(createMockRequest(url, { method: "DELETE" }));
  return res.status;
}

const salonIds = () => store.salons.map((s) => s.id).sort();

beforeEach(() => {
  nextId = 1;
  sessionUserId = null;
  store.salons = [
    { id: SALON_A, name: "Salon A", ownerId: OWNER_A },
    { id: SALON_B, name: "Salon B", ownerId: OWNER_B },
  ];
});

// -------------------------------------------------------
// DELETE
// -------------------------------------------------------

describe("DELETE /api/salons — trasa zdjęta, żaden salon nie znika", () => {
  it("konto A nie usuwa salonu B", async () => {
    sessionUserId = OWNER_A;
    expect(await callDelete(SALON_B)).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("klient bez salonu nie usuwa żadnego salonu", async () => {
    sessionUserId = CLIENT;
    expect(await callDelete(SALON_A)).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("brak sesji — nic nie znika", async () => {
    expect(await callDelete(SALON_A)).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("brak id — nic nie znika", async () => {
    sessionUserId = OWNER_A;
    expect(await callDelete()).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("właściciel też nie usuwa salonu przez API (kaskada 26 tabel — brak przepływu w UI)", async () => {
    sessionUserId = OWNER_A;
    expect(await callDelete(SALON_A)).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("moduł nie eksportuje DELETE", () => {
    expect((route as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

// -------------------------------------------------------
// POST
// -------------------------------------------------------

async function callPost(body: Row): Promise<{ status: number; body: Row }> {
  const res = await route.POST(
    createMockRequest("http://localhost/api/salons", { method: "POST", body }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const salonsOf = (ownerId: string) => store.salons.filter((s) => s.ownerId === ownerId);

describe("POST /api/salons — właściciel wyłącznie z sesji", () => {
  it("body z cudzym ownerId — salon należy do konta z sesji, nie do ofiary", async () => {
    sessionUserId = CLIENT;
    const { status, body } = await callPost({ name: "Nowy", ownerId: OWNER_B });
    expect(status).toBe(201);
    expect((body.data as Row).ownerId).toBe(CLIENT);
    expect(salonsOf(CLIENT)).toHaveLength(1);
    expect(salonsOf(OWNER_B)).toHaveLength(1); // tylko pierwotny Salon B
  });

  it("body z ownerId: null — salon nie zostaje bez właściciela", async () => {
    sessionUserId = CLIENT;
    const { status, body } = await callPost({ name: "Nowy", ownerId: null });
    expect(status).toBe(201);
    expect((body.data as Row).ownerId).toBe(CLIENT);
  });

  it("body bez ownerId — właściciel z sesji", async () => {
    sessionUserId = CLIENT;
    const { status, body } = await callPost({ name: "Nowy" });
    expect(status).toBe(201);
    expect((body.data as Row).ownerId).toBe(CLIENT);
  });

  it("brak sesji — 401, nic nie powstaje", async () => {
    const { status } = await callPost({ name: "Nowy", ownerId: OWNER_B });
    expect(status).toBe(401);
    expect(store.salons).toHaveLength(2);
  });

  it("brak nazwy — 400, nic nie powstaje", async () => {
    sessionUserId = CLIENT;
    const { status } = await callPost({ ownerId: CLIENT });
    expect(status).toBe(400);
    expect(store.salons).toHaveLength(2);
  });
});

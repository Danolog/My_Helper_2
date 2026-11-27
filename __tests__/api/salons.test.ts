/**
 * P0 · /api/salons — mutacje korzenia najemcy (tabela `salons`).
 *
 * POST (#86): tworzył salon bez wiersza subskrypcji (niezmiennik z recenzji §3),
 * nikt go nie wołał — zdjęty. Salon powstaje tylko przez
 * POST /api/register-subscription. Test: 405 i żaden salon nie powstaje.
 *
 * DELETE: przed poprawką każde zalogowane konto (także klient) usuwało dowolny
 * salon po id, a 26 FK do salons.id ma ON DELETE CASCADE (klienci, wizyty,
 * subskrypcje). Trasa nie ma wołającego w UI — zdjęta. Test sprawdza zachowanie
 * HTTP: metoda nieeksportowana => Next.js odpowiada 405, a żaden salon nie
 * znika — niezależnie od tego, kto pyta.
 *
 * GET (publiczna lista salonów) czyta wyłącznie przez funkcję systemową
 * `listPublicSalonCatalog` — tu atrapa; zapytania i listę kolumn sprawdza
 * `__tests__/lib/system-catalog.test.ts`. Trasa nie importuje surowego `db`,
 * więc „magazyn” salonów poniżej to tylko fikstura: test sprawdza, że żadna
 * metoda HTTP go nie zmienia.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as route from "@/app/api/salons/route";
import { logger } from "@/lib/logger";
import { listPublicSalonCatalog } from "@/lib/server/system";
import { createMockRequest } from "./helpers";

type Row = Record<string, unknown>;

const store: { salons: Row[] } = { salons: [] };

vi.mock("@/lib/server/system", () => ({ listPublicSalonCatalog: vi.fn() }));

// Katalog salonów jest zamrożony (`salonCatalog`, hardOff). Testy kształtu
// odpowiedzi GET odmrażają go atrapą rejestru; test zamrożenia — nie.
const catalog = vi.hoisted(() => ({ frozen: false }));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      key === "salonCatalog" ? catalog.frozen : actual.isModuleFrozen(key),
  };
});

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
// POST (#86)
// -------------------------------------------------------

/** Odpowiednik routera Next.js: metoda bez eksportu => 405. */
async function callPost(body: Row): Promise<number> {
  const handler = (route as Record<string, unknown>).POST as
    | ((req: Request) => Promise<Response>)
    | undefined;
  if (!handler) return 405;
  const res = await handler(createMockRequest("http://localhost/api/salons", { method: "POST", body }));
  return res.status;
}

describe("POST /api/salons — trasa zdjęta, salon bez subskrypcji nie powstaje (#86)", () => {
  it.each([
    ["konto bez salonu", CLIENT, { name: "Pierwszy" }],
    ["konto, które ma już salon", OWNER_A, { name: "Drugi salon A" }],
    ["cudzy ownerId w body", CLIENT, { name: "Nowy", ownerId: OWNER_B }],
    ["brak sesji", null, { name: "Nowy" }],
  ] as const)("%s — 405, nic nie powstaje", async (_label, user, body) => {
    sessionUserId = user;
    expect(await callPost({ ...body })).toBe(405);
    expect(salonIds()).toEqual([SALON_A, SALON_B]);
  });

  it("moduł nie eksportuje POST", () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it("GET (publiczny katalog) zostaje", () => {
    expect(typeof route.GET).toBe("function");
  });
});

// -------------------------------------------------------
// GET — publiczna lista salonów przez funkcję systemową
// -------------------------------------------------------

const CATALOG_ENTRY = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Salon A",
  phone: "+48500000000",
  email: "a@example.com",
  address: "Ul. Testowa 1",
  industryType: "spa",
  serviceCount: 2,
  averageRating: 4.5,
  reviewCount: 2,
};

describe("GET /api/salons — katalog zamrożony", () => {
  beforeEach(() => {
    catalog.frozen = true;
    vi.mocked(listPublicSalonCatalog).mockReset();
  });

  afterEach(() => {
    catalog.frozen = false;
  });

  it("404 MODULE_DISABLED i żadnego odczytu listy salonów", async () => {
    vi.mocked(listPublicSalonCatalog).mockResolvedValue([CATALOG_ENTRY]);
    const res = await route.GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      code: "MODULE_DISABLED",
      error: "Ta funkcja jest obecnie niedostępna.",
    });
    expect(listPublicSalonCatalog).not.toHaveBeenCalled();
  });

  it("rejestr bez atrapy: katalog naprawdę jest zamrożony", async () => {
    const actual = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
    expect(actual.isModuleFrozen("salonCatalog")).toBe(true);
  });
});

describe("GET /api/salons — lista przez listPublicSalonCatalog (po odmrożeniu)", () => {
  beforeEach(() => {
    catalog.frozen = false;
    vi.mocked(listPublicSalonCatalog).mockReset();
    vi.mocked(logger.error).mockClear();
  });

  it("200 — kształt odpowiedzi bez zmian (success, data, count)", async () => {
    vi.mocked(listPublicSalonCatalog).mockResolvedValue([CATALOG_ENTRY]);
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [CATALOG_ENTRY], count: 1 });
    expect(listPublicSalonCatalog).toHaveBeenCalledTimes(1);
  });

  it("200 — pusta lista: data [] i count 0", async () => {
    vi.mocked(listPublicSalonCatalog).mockResolvedValue([]);
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [], count: 0 });
  });

  it("500 przy błędzie funkcji; log z samą tożsamością błędu, bez obiektu i treści błędu", async () => {
    const err = Object.assign(new Error("Failed query: select ...\nparams: +48500000000"), { code: "57P01" });
    vi.mocked(listPublicSalonCatalog).mockRejectedValue(err);
    const res = await route.GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch salons" });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = vi.mocked(logger.error).mock.calls[0]!;
    expect(meta).toEqual({ errorName: "Error", errorCode: "57P01" });
    expect(JSON.stringify(meta)).not.toContain("params");
  });

  it("revalidate = 60 bez zmian", () => {
    expect(route.revalidate).toBe(60);
  });

  it("trasa nie importuje surowego db (żadna forma)", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../src/app/api/salons/route.ts"), "utf8");
    expect(text).not.toMatch(/["'`]@\/lib\/db["'`]/);
    expect(text).not.toMatch(/["'`][./]*lib\/db["'`]/);
    expect(text).toMatch(/from "@\/lib\/server\/system"/);
  });
});

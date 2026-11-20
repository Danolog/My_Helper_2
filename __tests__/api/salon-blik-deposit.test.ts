/**
 * GET/PUT /api/salon/blik-deposit — numer BLIK salonu dla zadatków (D1 K1).
 *
 * Przez prawdziwą bramkę (requireSalonStaff) i prawdziwe forSalon —
 * mockowane tylko krawędzie z salon-staff-harness (sesja, pule bazy).
 * Argument `set(...)` UPDATE jest przechwytywany i renderowany dialektem
 * Postgresa: tak sprawdzamy, że zapis to jeden atomowy `jsonb_set` na
 * kluczu `deposits` (inne klucze settingsJson zostają), a nie zapis
 * całego obiektu ustawień.
 *
 * Numery: fikcyjne. Ścieżka pozytywna wymaga zakresu komórkowego, więc
 * numerów z TEST_PHONE_NUMBERS (+48 000 …) użyć się tu nie da; testy
 * jednostkowe nie wysyłają SMS ani nie wychodzą do sieci.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, PUT } from "@/app/api/salon/blik-deposit/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  /** Argumenty każdego tx.update(...).set(x). */
  const setArgs: Record<string, unknown>[] = [];
  const state = { failDb: false };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      if (state.failDb) return Promise.reject(new Error("connection refused"));
      return m.db.transaction((tx) =>
        fn({
          ...tx,
          update: () => {
            const chain = tx.update();
            chain.set = (v: Record<string, unknown>) => {
              setArgs.push(v);
              return chain;
            };
            return chain;
          },
        })
      );
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, setArgs, state, db, logger };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: h.m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

// Fikcyjne numery komórkowe (format jak z formularza) i ich postać E.164.
const MOBILE_INPUT = "+48 600-100-200";
const MOBILE_E164 = "+48600100200";
const FIXED_NOW = new Date("2026-11-20T10:00:00.000Z");

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/salon/blik-deposit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

/** SQL wartości `settingsJson` z ostatniego UPDATE: tekst i parametry. */
function lastSettingsWrite() {
  const arg = h.setArgs.at(-1);
  expect(arg, "brak tx.update().set()").toBeDefined();
  expect(Object.keys(arg!)).toEqual(["settingsJson"]);
  return dialect.sqlToQuery(arg!.settingsJson as SQL);
}

/** Wszystko, co trafiło do loggera — jako tekst (komunikaty i konteksty). */
function loggedText(): string {
  return JSON.stringify(
    [h.logger.info, h.logger.warn, h.logger.error, h.logger.debug].flatMap((fn) => fn.mock.calls)
  );
}

beforeEach(() => {
  m.reset();
  h.setArgs.length = 0;
  h.state.failDb = false;
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/salon/blik-deposit", () => {
  it("200: właściciel dostaje numer i datę zgody ze swojego salonu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      { deposits: { blikPhone: MOBILE_E164, blikConsentAt: "2026-11-19T08:00:00.000Z" } },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { blikPhone: MOBILE_E164, blikConsentAt: "2026-11-19T08:00:00.000Z" },
    });
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("200: brak klucza deposits => oba pola null", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ deposits: null }]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ blikPhone: null, blikConsentAt: null });
  });

  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it.each(["receptionist", "employee"] as const)("403 dla roli %s — numer nie wychodzi", async (role) => {
    m.asStaffOf(SALON_A, role);
    m.txRows.push([{ deposits: { blikPhone: MOBILE_E164, blikConsentAt: null } }]);

    const res = await GET();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(MOBILE_E164);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("404: konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await GET()).status).toBe(404);
  });

  it("404: wiersz salonu nie istnieje", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await GET()).status).toBe(404);
  });

  it("500: błąd bazy", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

describe("PUT /api/salon/blik-deposit", () => {
  it("200: numer +48 600-100-200 normalizowany do E.164, data zgody z serwera", async () => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ blikPhone: MOBILE_INPUT, consent: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ blikPhone: MOBILE_E164, blikConsentAt: FIXED_NOW.toISOString() });

    const write = lastSettingsWrite();
    expect(write.params).toContain(
      JSON.stringify({ blikPhone: MOBILE_E164, blikConsentAt: FIXED_NOW.toISOString() })
    );
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("zapis atomowy: jeden jsonb_set na kluczu deposits — inne klucze settingsJson (modules) zostają", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(200);

    expect(h.setArgs).toHaveLength(1);
    const write = lastSettingsWrite();
    // Nowa wartość budowana z bieżącej kolumny w tym samym UPDATE — bez
    // wcześniejszego odczytu i bez nadpisania całego obiektu ustawień.
    expect(write.sql).toMatch(
      /^jsonb_set\(coalesce\("salons"\."settings_json", '\{\}'::jsonb\), '\{deposits\}', \$1::jsonb\)$/
    );
    expect(write.params).toHaveLength(1);
    expect(JSON.parse(write.params[0] as string)).not.toHaveProperty("modules");

    // UPDATE zawężony do salonu z sesji.
    const update = m.writes.find((w) => w.op === "update");
    const where = dialect.sqlToQuery(update!.where as SQL);
    expect(where.sql).toBe('"salons"."id" = $1');
    expect(where.params).toEqual([SALON_A]);
  });

  it("data zgody z body jest ignorowana — zawsze czas serwera", async () => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({
      blikPhone: MOBILE_INPUT,
      consent: true,
      blikConsentAt: "2020-01-01T00:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data.blikConsentAt).toBe(FIXED_NOW.toISOString());
    expect(lastSettingsWrite().params[0]).not.toContain("2020-01-01");
  });

  it.each([null, ""])("200: blikPhone %j czyści numer i datę zgody (bez zgody w body)", async (value) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ blikPhone: value });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ blikPhone: null, blikConsentAt: null });
    expect(JSON.parse(lastSettingsWrite().params[0] as string)).toEqual({
      blikPhone: null,
      blikConsentAt: null,
    });
  });

  it.each([
    ["stacjonarny Wrocław (71)", "+48 71 000 00 00"],
    ["stacjonarny Warszawa (22)", "+48 22 000 00 00"],
    ["stacjonarny Gdańsk (58) — przepuszczała go reguła 4–8", "58 000 00 00"],
    ["stacjonarny Poznań (61)", "61 000 00 00"],
    ["8 cyfr", "60010020"],
    ["10 cyfr", "6001002000"],
    ["litery", "600-ABC-200"],
    ["obcy kierunkowy", "+49 600 100 200"],
  ])("400: %s", async (_label, blikPhone) => {
    m.asOwnerOf(SALON_A);

    const res = await put({ blikPhone, consent: true });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty("blikPhone");
    expect(h.setArgs).toEqual([]);
  });

  it.each([
    ["brak consent", { blikPhone: MOBILE_INPUT }],
    ["consent false", { blikPhone: MOBILE_INPUT, consent: false }],
    ["consent jako napis", { blikPhone: MOBILE_INPUT, consent: "true" }],
  ])("400: numer bez zgody — %s", async (_label, payload) => {
    m.asOwnerOf(SALON_A);

    const res = await put(payload);

    expect(res.status).toBe(400);
    expect((await res.json()).details).toHaveProperty("consent");
    expect(h.setArgs).toEqual([]);
  });

  it("400: brak klucza blikPhone nie kasuje ustawienia", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put({ consent: true });
    expect(res.status).toBe(400);
    expect(h.setArgs).toEqual([]);
  });

  it("400: body nie jest JSON-em", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put("{nie-json");
    expect(res.status).toBe(400);
    expect(h.setArgs).toEqual([]);
  });

  it("400: odpowiedź walidacji nie zawiera numeru", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put({ blikPhone: "+48 71 000 00 00", consent: true });
    expect(JSON.stringify(await res.json())).not.toMatch(/71\s?000/);
  });

  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(401);
    expect(h.setArgs).toEqual([]);
  });

  it.each(["receptionist", "employee"] as const)("403 dla roli %s — brak zapisu", async (role) => {
    m.asStaffOf(SALON_A, role);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ blikPhone: MOBILE_INPUT, consent: true });

    expect(res.status).toBe(403);
    expect(h.setArgs).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("403 dla recepcji także z grantem temporary_access (trasa tylko dla właściciela)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);

    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(403);
    expect(h.setArgs).toEqual([]);
  });

  it("404: konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(404);
    expect(h.setArgs).toEqual([]);
  });

  it("404: UPDATE nie trafił w żaden wiersz salonu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(404);
  });

  it("500: błąd bazy — numer nie trafia do logów ani odpowiedzi", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await put({ blikPhone: MOBILE_INPUT, consent: true });

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("600");
    expect(h.logger.error).toHaveBeenCalled();
    expect(loggedText()).not.toMatch(/600[\s-]?100[\s-]?200/);
  });

  it("numer nie trafia do logów przy udanym zapisie i przy błędzie walidacji", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);
    expect((await put({ blikPhone: MOBILE_INPUT, consent: true })).status).toBe(200);

    m.asOwnerOf(SALON_A);
    expect((await put({ blikPhone: "+48 71 000 00 00", consent: true })).status).toBe(400);

    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), {
      salonId: SALON_A,
      configured: true,
    });
    const logged = loggedText();
    expect(logged).not.toMatch(/600[\s-]?100[\s-]?200/);
    expect(logged).not.toMatch(/71\s?000/);
  });
});

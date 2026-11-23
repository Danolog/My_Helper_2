/**
 * GET/PUT /api/salon/blik-deposit — numer BLIK salonu dla zadatków.
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
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { GET, PUT } from "@/app/api/salon/blik-deposit/route";
import {
  BLIK_CONSENT_VERSION,
  BLIK_CONSENT_VERSION_STALE,
  BLIK_SETTINGS_NOT_AVAILABLE,
} from "@/lib/blik-consent";
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

function put(body: unknown, handler: typeof PUT = PUT) {
  return handler(
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
  it("200: właściciel dostaje numer, datę i wersję zgody — bieżąca wersja => consentCurrent true", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      {
        deposits: {
          blikPhone: MOBILE_E164,
          blikConsentAt: "2026-11-19T08:00:00.000Z",
          blikConsentVersion: BLIK_CONSENT_VERSION,
        },
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        blikPhone: MOBILE_E164,
        blikConsentAt: "2026-11-19T08:00:00.000Z",
        blikConsentVersion: BLIK_CONSENT_VERSION,
        consentCurrent: true,
      },
    });
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("200: stara wersja zgody => consentCurrent false", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      {
        deposits: {
          blikPhone: MOBILE_E164,
          blikConsentAt: "2026-11-19T08:00:00.000Z",
          blikConsentVersion: "2026-01-01",
        },
      },
    ]);

    const data = (await (await GET()).json()).data;
    expect(data.blikConsentVersion).toBe("2026-01-01");
    expect(data.consentCurrent).toBe(false);
  });

  it("200: numer zapisany bez wersji (kształt danych testowych) => wersja null, consentCurrent false", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      { deposits: { blikPhone: MOBILE_E164, blikConsentAt: "2026-11-19T08:00:00.000Z" } },
    ]);

    expect((await (await GET()).json()).data).toEqual({
      blikPhone: MOBILE_E164,
      blikConsentAt: "2026-11-19T08:00:00.000Z",
      blikConsentVersion: null,
      consentCurrent: false,
    });
  });

  it("200: bieżąca wersja bez daty zgody => consentCurrent false", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      { deposits: { blikPhone: MOBILE_E164, blikConsentVersion: BLIK_CONSENT_VERSION } },
    ]);

    expect((await (await GET()).json()).data.consentCurrent).toBe(false);
  });

  it("200: obcy typ wersji => null", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      { deposits: { blikPhone: MOBILE_E164, blikConsentAt: "x", blikConsentVersion: 20261121 } },
    ]);

    const data = (await (await GET()).json()).data;
    expect(data.blikConsentVersion).toBeNull();
    expect(data.consentCurrent).toBe(false);
  });

  it("200: brak klucza deposits => wszystkie pola null, consentCurrent false", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ deposits: null }]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      blikPhone: null,
      blikConsentAt: null,
      blikConsentVersion: null,
      consentCurrent: false,
    });
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

/** Poprawne body zapisu numeru (zgoda i bieżąca wersja treści). */
const VALID_SAVE = { blikPhone: MOBILE_INPUT, consent: true, consentVersion: BLIK_CONSENT_VERSION };

describe("PUT /api/salon/blik-deposit (zapis numeru zamknięty — adres polityki prywatności null)", () => {
  it.each([
    ["bieżąca wersja", BLIK_CONSENT_VERSION],
    ["stara wersja — pierwszeństwo przed STALE", "2026-01-01"],
  ])("409 BLIK_SETTINGS_NOT_AVAILABLE: %s — brak zapisu, numer poza odpowiedzią i logiem", async (_label, consentVersion) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ ...VALID_SAVE, consentVersion });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: BLIK_SETTINGS_NOT_AVAILABLE });
    expect(h.setArgs).toEqual([]);
    expect(m.writes.filter((w) => w.op === "update")).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/600[\s-]?100[\s-]?200/);
    expect(loggedText()).not.toMatch(/600[\s-]?100[\s-]?200/);
  });

  it("409 BLIK_SETTINGS_NOT_AVAILABLE: pole body ani nagłówek nie otwierają zapisu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await PUT(
      new Request("http://localhost/api/salon/blik-deposit", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-blik-privacy-policy-href": "/privacy" },
        body: JSON.stringify({
          ...VALID_SAVE,
          BLIK_PRIVACY_POLICY_HREF: "/privacy",
          privacyPolicyHref: "/privacy",
        }),
      })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe(BLIK_SETTINGS_NOT_AVAILABLE);
    expect(h.setArgs).toEqual([]);
  });

  it.each([null, ""])("200: blikPhone %j czyści numer, datę i wersję zgody także przy zamkniętym zapisie (bez zgody i wersji w body)", async (value) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ blikPhone: value });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      blikPhone: null,
      blikConsentAt: null,
      blikConsentVersion: null,
      consentCurrent: false,
    });
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

    const res = await put({ blikPhone, consent: true, consentVersion: BLIK_CONSENT_VERSION });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty("blikPhone");
    expect(h.setArgs).toEqual([]);
  });

  it.each([
    ["brak consent", { blikPhone: MOBILE_INPUT, consentVersion: BLIK_CONSENT_VERSION }],
    ["consent false", { blikPhone: MOBILE_INPUT, consent: false, consentVersion: BLIK_CONSENT_VERSION }],
    ["consent jako napis", { blikPhone: MOBILE_INPUT, consent: "true", consentVersion: BLIK_CONSENT_VERSION }],
  ])("400: numer bez zgody — %s", async (_label, payload) => {
    m.asOwnerOf(SALON_A);

    const res = await put(payload);

    expect(res.status).toBe(400);
    expect((await res.json()).details).toHaveProperty("consent");
    expect(h.setArgs).toEqual([]);
  });

  it.each([
    ["brak consentVersion", { blikPhone: MOBILE_INPUT, consent: true }],
    ["consentVersion jako liczba", { blikPhone: MOBILE_INPUT, consent: true, consentVersion: 20261121 }],
    ["consentVersion dłuższy niż 32 znaki", { blikPhone: MOBILE_INPUT, consent: true, consentVersion: "x".repeat(33) }],
  ])("400: numer z błędną wersją zgody — %s", async (_label, payload) => {
    m.asOwnerOf(SALON_A);

    const res = await put(payload);

    expect(res.status).toBe(400);
    expect((await res.json()).details).toHaveProperty("consentVersion");
    expect(h.setArgs).toEqual([]);
  });

  it("400: brak klucza blikPhone nie kasuje ustawienia", async () => {
    m.asOwnerOf(SALON_A);
    const res = await put({ consent: true, consentVersion: BLIK_CONSENT_VERSION });
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
    const res = await put({ blikPhone: "+48 71 000 00 00", consent: true, consentVersion: BLIK_CONSENT_VERSION });
    expect(JSON.stringify(await res.json())).not.toMatch(/71\s?000/);
  });

  it("401 bez sesji", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await put(VALID_SAVE)).status).toBe(401);
    expect(h.setArgs).toEqual([]);
  });

  it.each(["receptionist", "employee"] as const)("403 dla roli %s — brak zapisu", async (role) => {
    m.asStaffOf(SALON_A, role);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put(VALID_SAVE);

    expect(res.status).toBe(403);
    expect(h.setArgs).toEqual([]);
    expect(m.rlsSalonIds()).toEqual([]);
  });

  it("403 dla recepcji także z grantem temporary_access (trasa tylko dla właściciela)", async () => {
    m.asStaffOf(SALON_A, "receptionist");
    m.hasTemporaryAccess.mockResolvedValue(true);

    expect((await put(VALID_SAVE)).status).toBe(403);
    expect(h.setArgs).toEqual([]);
  });

  it("404: konto bez salonu", async () => {
    m.signIn("client-1");
    m.ctxRows.push([], []);
    expect((await put(VALID_SAVE)).status).toBe(404);
    expect(h.setArgs).toEqual([]);
  });

  it("404: UPDATE usunięcia numeru nie trafił w żaden wiersz salonu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await put({ blikPhone: null })).status).toBe(404);
  });

  it("500: błąd bazy przy usunięciu numeru", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await put({ blikPhone: null });

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    expect(h.logger.error).toHaveBeenCalled();
  });
});

/**
 * Gałęzie nieosiągalne przy zamkniętym zapisie (200 z numerem i STALE):
 * trasa ładowana ponownie z atrapą `@/lib/blik-consent`, w której adres
 * polityki prywatności jest napisem. Pozostałe atrapy (sesja, baza, logger)
 * są te same co wyżej.
 */
describe("PUT /api/salon/blik-deposit (zapis numeru otwarty — stała podmieniona w atrapie)", () => {
  let openPut: typeof PUT;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("@/lib/blik-consent", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/blik-consent")>()),
      BLIK_PRIVACY_POLICY_HREF: "/privacy",
    }));
    ({ PUT: openPut } = await import("@/app/api/salon/blik-deposit/route"));
  });

  afterAll(() => {
    vi.doUnmock("@/lib/blik-consent");
    vi.resetModules();
  });

  it("200: numer +48 600-100-200 normalizowany do E.164, data i wersja zgody z serwera", async () => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put(VALID_SAVE, openPut);
    const body = await res.json();

    const expected = {
      blikPhone: MOBILE_E164,
      blikConsentAt: FIXED_NOW.toISOString(),
      blikConsentVersion: BLIK_CONSENT_VERSION,
    };
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ ...expected, consentCurrent: true });
    expect(lastSettingsWrite().params).toContain(JSON.stringify(expected));
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("zapis atomowy: jeden jsonb_set na kluczu deposits — inne klucze settingsJson (modules) zostają", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    expect((await put(VALID_SAVE, openPut)).status).toBe(200);

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

  it("data i zapisywana wersja zgody z body są ignorowane — zawsze wartości serwera", async () => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ["Date"] });
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put(
      {
        ...VALID_SAVE,
        blikConsentAt: "2020-01-01T00:00:00.000Z",
        blikConsentVersion: "2020-01-01",
      },
      openPut
    );

    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.blikConsentAt).toBe(FIXED_NOW.toISOString());
    expect(data.blikConsentVersion).toBe(BLIK_CONSENT_VERSION);
    expect(data.consentCurrent).toBe(true);
    expect(lastSettingsWrite().params[0]).not.toContain("2020-01-01");
  });

  it.each([
    ["stara wersja", "2026-01-01"],
    ["poprzednia wersja treści", "2026-11-21"],
    ["pusty napis", ""],
  ])("409 BLIK_CONSENT_VERSION_STALE: %s — brak zapisu, numer poza odpowiedzią i logiem", async (_label, consentVersion) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ ...VALID_SAVE, consentVersion }, openPut);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: BLIK_CONSENT_VERSION_STALE });
    expect(h.setArgs).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/600[\s-]?100[\s-]?200/);
    expect(loggedText()).not.toMatch(/600[\s-]?100[\s-]?200/);
  });

  it.each([null, ""])("200: blikPhone %j czyści numer bez wersji w body", async (value) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);

    const res = await put({ blikPhone: value }, openPut);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      blikPhone: null,
      blikConsentAt: null,
      blikConsentVersion: null,
      consentCurrent: false,
    });
    expect(JSON.parse(lastSettingsWrite().params[0] as string)).toEqual({
      blikPhone: null,
      blikConsentAt: null,
    });
  });

  it("404: UPDATE nie trafił w żaden wiersz salonu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);
    expect((await put(VALID_SAVE, openPut)).status).toBe(404);
  });

  it("500: błąd bazy — numer nie trafia do logów ani odpowiedzi", async () => {
    m.asOwnerOf(SALON_A);
    h.state.failDb = true;

    const res = await put(VALID_SAVE, openPut);

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("600");
    expect(h.logger.error).toHaveBeenCalled();
    expect(loggedText()).not.toMatch(/600[\s-]?100[\s-]?200/);
  });

  it("numer nie trafia do logów przy udanym zapisie i przy błędzie walidacji", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: SALON_A }]);
    expect((await put(VALID_SAVE, openPut)).status).toBe(200);

    m.asOwnerOf(SALON_A);
    expect(
      (await put({ ...VALID_SAVE, blikPhone: "+48 71 000 00 00" }, openPut)).status
    ).toBe(400);

    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), {
      salonId: SALON_A,
      configured: true,
    });
    const logged = loggedText();
    expect(logged).not.toMatch(/600[\s-]?100[\s-]?200/);
    expect(logged).not.toMatch(/71\s?000/);
  });
});

/**
 * #193: `/api/clients/[id]/loyalty/redeem` (GET, POST) — statusy i kształt
 * odpowiedzi po przejściu z surowego `db` na `forSalon(salonId)`.
 *
 * Każde zapytanie (także odczyt ustawień `salons`) biegnie w transakcji bramy
 * salonu: `@/lib/db` w tym teście ma tylko `transaction`, więc zapytanie na
 * surowej puli rzuciłoby wyjątek (500). `forSalon` jest wołany wyłącznie
 * z salonem z sesji. Trasa nie ma sprawdzenia roli (brak 403) — bez zmian.
 *
 * Body POST = kontrakt panelu (client-loyalty-tab.tsx): `{ rewardTierId, salonId }`.
 * `salonId` z body trasa ignoruje — salon zawsze z sesji.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/clients/[id]/loyalty/redeem/route";
import { createChainMock, createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

const ctl = vi.hoisted(() => ({
  results: [] as unknown[][],
  chains: [] as Record<string, ReturnType<typeof vi.fn>>[],
  transactions: 0,
  forSalonCalls: [] as string[],
  requireAuth: vi.fn(),
  getUserSalonId: vi.fn(),
}));

function nextChain() {
  if (ctl.results.length === 0) throw new Error("test: brak zaplanowanego wyniku zapytania");
  const chain = createChainMock(ctl.results.shift() as Record<string, unknown>[]);
  ctl.chains.push(chain as Record<string, ReturnType<typeof vi.fn>>);
  return chain;
}

vi.mock("@/lib/db", () => {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: () => nextChain(),
    update: () => nextChain(),
    insert: () => nextChain(),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => unknown) => {
        ctl.transactions += 1;
        return fn(tx);
      },
    },
  };
});

vi.mock("@/lib/server/repository", async (orig) => {
  const real = await orig<typeof import("@/lib/server/repository")>();
  return {
    ...real,
    forSalon: (salonId: string) => {
      ctl.forSalonCalls.push(salonId);
      return real.forSalon(salonId);
    },
  };
});

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => ctl.requireAuth(...a),
  isAuthError: (r: unknown) => r instanceof Response,
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...a: unknown[]) => ctl.getUserSalonId(...a),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SALON = TEST_IDS.SALON_UUID;
const CLIENT = TEST_IDS.CLIENT_UUID;
const LOYALTY_ID = TEST_IDS.VALID_UUID;
// Schemat nie wymaga UUID dla rewardTierId (tylko niepusty napis); tu UUID jak z ustawień salonu.
const TIER = { id: "77777777-7777-4777-8777-777777777777", name: "Rabat", pointsRequired: 100, rewardType: "discount", rewardValue: 10 };
const TIER_BIG = { id: "88888888-8888-4888-8888-888888888888", name: "Gratis", pointsRequired: 500, rewardType: "free_service", rewardValue: 80 };
const UNKNOWN_TIER = "99999999-9999-4999-8999-999999999999";
const salonRow = (enabled = true) => ({
  id: SALON,
  settingsJson: { loyalty: { enabled, rewardTiers: [TIER_BIG, TIER] } },
});
const pointsRow = (points: number) => ({ id: LOYALTY_ID, salonId: SALON, clientId: CLIENT, points });

const OTHER_SALON = "66666666-6666-4666-8666-666666666666";
const postReq = (body: unknown) =>
  createMockRequest(`http://localhost/api/clients/${CLIENT}/loyalty/redeem`, { method: "POST", body });
/** Body tak, jak wysyła je panel. */
const panelBody = (rewardTierId: string, salonId: string = SALON) => ({ rewardTierId, salonId });
const getReq = () => createMockRequest(`http://localhost/api/clients/${CLIENT}/loyalty/redeem`);

beforeEach(() => {
  ctl.results = [];
  ctl.chains = [];
  ctl.transactions = 0;
  ctl.forSalonCalls = [];
  ctl.requireAuth.mockReset().mockResolvedValue({ user: { id: "owner-1" } });
  ctl.getUserSalonId.mockReset().mockResolvedValue(SALON);
});

describe("POST /api/clients/[id]/loyalty/redeem", () => {
  it("200: odejmuje punkty, zapisuje transakcję, wszystko w bramie salonu z sesji", async () => {
    ctl.results = [[salonRow()], [pointsRow(150)], [pointsRow(50)], [{ id: "tx-1" }]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        redemption: {
          rewardTierId: TIER.id,
          rewardName: TIER.name,
          rewardType: TIER.rewardType,
          rewardValue: TIER.rewardValue,
          pointsSpent: 100,
          transactionId: "tx-1",
        },
        balance: { previousPoints: 150, currentPoints: 50 },
      },
      message: `Nagroda "${TIER.name}" zostala zrealizowana! Wykorzystano 100 punktow.`,
    });
    expect(ctl.transactions).toBe(4);
    expect(ctl.forSalonCalls.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ctl.forSalonCalls)).toEqual(new Set([SALON]));
    expect(ctl.chains[2]!.set).toHaveBeenCalledWith(expect.objectContaining({ points: 50 }));
    expect(ctl.chains[3]!.values).toHaveBeenCalledWith(
      expect.objectContaining({ loyaltyId: LOYALTY_ID, pointsChange: -100, appointmentId: null })
    );
  });

  it("401: brak sesji — bez zapytań do bazy", async () => {
    ctl.requireAuth.mockResolvedValue(NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }));
    const res = await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT));
    expect(res.status).toBe(401);
    expect(ctl.transactions).toBe(0);
  });

  it("400: niepoprawne body — bez zapytań do bazy", async () => {
    const res = await POST(postReq({}), createRouteParams(CLIENT));
    expect(res.status).toBe(400);
    expect(ctl.transactions).toBe(0);
  });

  it("400: brak rewardTierId (samo salonId) — błąd pola, bez zapytań do bazy", async () => {
    const { status, body } = await parseResponse<{ error: string; details: Record<string, string> }>(
      await POST(postReq({ salonId: SALON }), createRouteParams(CLIENT))
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(body.details.rewardTierId).toBeDefined();
    expect(ctl.transactions).toBe(0);
  });

  it("400: stary kształt { tierId, pointsToRedeem } — bez zapytań do bazy", async () => {
    const { status, body } = await parseResponse<{ error: string }>(
      await POST(postReq({ tierId: TIER.id, pointsToRedeem: 100 }), createRouteParams(CLIENT))
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(ctl.transactions).toBe(0);
  });

  it("200: salonId z body innego salonu ignorowany — brama tylko z salonem z sesji", async () => {
    ctl.results = [[salonRow()], [pointsRow(150)], [pointsRow(50)], [{ id: "tx-3" }]];
    const { status, body } = await parseResponse(
      await POST(postReq(panelBody(TIER.id, OTHER_SALON)), createRouteParams(CLIENT))
    );
    expect(status, JSON.stringify(body)).toBe(200);
    expect(new Set(ctl.forSalonCalls)).toEqual(new Set([SALON]));
  });

  it("404: brak salonu w sesji — bez zapytań do bazy", async () => {
    ctl.getUserSalonId.mockResolvedValue(null);
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon not found" });
    expect(ctl.transactions).toBe(0);
  });

  it("404: wiersz salonu niewidoczny w bramie (RLS / brak)", async () => {
    ctl.results = [[]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon nie znaleziony" });
  });

  it("400: program lojalnościowy wyłączony", async () => {
    ctl.results = [[salonRow(false)]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: "Program lojalnosciowy nie jest aktywny" });
  });

  it("404: nieznana nagroda", async () => {
    ctl.results = [[salonRow()]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(UNKNOWN_TIER)), createRouteParams(CLIENT)));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Nie znaleziono nagrody o podanym ID" });
    expect(ctl.transactions).toBe(1);
  });

  it("404 (nie 400 walidacji): id nagrody spoza formatu UUID — bez zapisu", async () => {
    ctl.results = [[salonRow()]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody("nie-ma")), createRouteParams(CLIENT)));
    expect(status).toBe(404);
    expect(body.error).toBe("Nie znaleziono nagrody o podanym ID");
    expect(ctl.transactions).toBe(1);
  });

  it("400: klient bez konta punktów (także klient innego salonu) — bez zapisu", async () => {
    ctl.results = [[salonRow()], []];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(400);
    expect(body.error).toBe("Niewystarczajaca liczba punktow. Wymagane: 100, dostepne: 0");
    expect(ctl.transactions).toBe(2);
  });

  it("400: za mało punktów — bez zapisu", async () => {
    ctl.results = [[salonRow()], [pointsRow(99)]];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(400);
    expect(body.error).toBe("Niewystarczajaca liczba punktow. Wymagane: 100, dostepne: 99");
    expect(ctl.transactions).toBe(2);
  });

  it("200: punkty równe progowi → saldo 0", async () => {
    ctl.results = [[salonRow()], [pointsRow(100)], [pointsRow(0)], [{ id: "tx-2" }]];
    const { status, body } = await parseResponse<{ data: { balance: unknown } }>(
      await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT))
    );
    expect(status).toBe(200);
    expect(body.data.balance).toEqual({ previousPoints: 100, currentPoints: 0 });
  });

  it("500: pusty wynik zapisu transakcji", async () => {
    ctl.results = [[salonRow()], [pointsRow(150)], [pointsRow(50)], []];
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Blad podczas realizacji nagrody" });
  });

  it("500: błąd bazy — bez stack trace w odpowiedzi", async () => {
    // brak zaplanowanego wyniku → wyjątek w pierwszym zapytaniu
    const { status, body } = await parseResponse(await POST(postReq(panelBody(TIER.id)), createRouteParams(CLIENT)));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Blad podczas realizacji nagrody" });
  });
});

describe("GET /api/clients/[id]/loyalty/redeem", () => {
  it("200: punkty i nagrody posortowane, odczyty w bramie salonu z sesji", async () => {
    ctl.results = [[salonRow()], [pointsRow(150)]];
    const { status, body } = await parseResponse(await GET(getReq(), createRouteParams(CLIENT)));
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        enabled: true,
        points: 150,
        availableRewards: [{ ...TIER, canRedeem: true, pointsNeeded: 0 }],
        allRewards: [
          { ...TIER, canRedeem: true, pointsNeeded: 0 },
          { ...TIER_BIG, canRedeem: false, pointsNeeded: 350 },
        ],
      },
    });
    expect(ctl.transactions).toBe(2);
    expect(new Set(ctl.forSalonCalls)).toEqual(new Set([SALON]));
  });

  it("200: program wyłączony → pusty kształt, bez odczytu punktów", async () => {
    ctl.results = [[salonRow(false)]];
    const { status, body } = await parseResponse(await GET(getReq(), createRouteParams(CLIENT)));
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: { enabled: false, points: 0, availableRewards: [], allRewards: [] } });
    expect(ctl.transactions).toBe(1);
  });

  it("200: brak konta punktów (także klient innego salonu) → 0 punktów", async () => {
    ctl.results = [[salonRow()], []];
    const { status, body } = await parseResponse<{ data: { points: number; availableRewards: unknown[] } }>(
      await GET(getReq(), createRouteParams(CLIENT))
    );
    expect(status).toBe(200);
    expect(body.data.points).toBe(0);
    expect(body.data.availableRewards).toEqual([]);
  });

  it("401: brak sesji", async () => {
    ctl.requireAuth.mockResolvedValue(NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }));
    const res = await GET(getReq(), createRouteParams(CLIENT));
    expect(res.status).toBe(401);
    expect(ctl.transactions).toBe(0);
  });

  it("404: brak salonu w sesji", async () => {
    ctl.getUserSalonId.mockResolvedValue(null);
    const res = await GET(getReq(), createRouteParams(CLIENT));
    expect(res.status).toBe(404);
    expect(ctl.transactions).toBe(0);
  });

  it("404: wiersz salonu niewidoczny w bramie", async () => {
    ctl.results = [[]];
    const { status, body } = await parseResponse(await GET(getReq(), createRouteParams(CLIENT)));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon nie znaleziony" });
  });

  it("500: błąd bazy", async () => {
    const { status, body } = await parseResponse(await GET(getReq(), createRouteParams(CLIENT)));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Blad podczas pobierania nagrod" });
  });
});

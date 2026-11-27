/**
 * POST /api/deposits/create-session przy wyłączonym zadatku
 * (`isDepositEnabled()` = false w `src/lib/features.ts`, rejestr PRAWDZIWY).
 *
 * Trasa odpowiada 400 `DEPOSIT_NOT_APPLICABLE` (powód `DEPOSITS_DISABLED`
 * w polu `reason`), zanim cokolwiek trafi do dostawcy płatności: bez odczytu
 * sesji, bez wyliczenia zadatku, bez zapisu do bazy, bez sesji Checkout.
 * Dotyczy także rezerwacji usługi albo klienta, które mają flagę zadatku
 * zapisaną wcześniej, i działa tak samo przy skonfigurowanym kluczu płatności
 * kartą.
 *
 * Nie 409: front i stare wersje PWA mapują 409 na „termin zajęty”. Na 400
 * z tym kodem portal (`isDepositNotApplicable`) rezerwuje zwykłą ścieżką
 * przez /api/appointments — kontrakt obu stron sprawdza osobny blok niżej.
 *
 * Logika trasy po włączeniu zadatku: deposits-create-session*.test.ts
 * (tam `isDepositEnabled` podmienione na true).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";
import {
  buildDepositBody,
  isDepositNotApplicable,
} from "@/app/(client)/salons/[id]/book/_lib/deposit-body";

const h = vi.hoisted(() => ({
  dbCall: vi.fn(),
  getOptionalSession: vi.fn(),
  getSalonContext: vi.fn(),
  calcDeposit: vi.fn(),
  assertSalonRefs: vi.fn(),
  isStripeConfigured: vi.fn(),
  getStripe: vi.fn(),
  sessionsCreate: vi.fn(),
  rateLimitCheck: vi.fn(),
}));

// Blokadę rezerwacji online sprawdzają osobne testy (online-booking-block*).
vi.mock("@/lib/online-booking-block", () => ({ onlineBookingBlockResponse: async () => null }));
vi.mock("@/lib/db", () => {
  const touch = (name: string) => (...a: unknown[]) => {
    h.dbCall(name, ...a);
    throw new Error(`db.${name} nie może być wołane przy wyłączonym zadatku`);
  };
  return {
    db: {
      select: touch("select"),
      insert: touch("insert"),
      update: touch("update"),
      delete: touch("delete"),
      transaction: touch("transaction"),
    },
  };
});
vi.mock("@/lib/session", () => ({ getOptionalSession: h.getOptionalSession }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: h.getSalonContext }));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: h.calcDeposit }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: h.assertSalonRefs }));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: h.isStripeConfigured,
  getStripe: h.getStripe,
}));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: h.rateLimitCheck },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { POST as createSession } from "@/app/api/deposits/create-session/route";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";

const validBody = {
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  startTime: "2026-12-01T10:00:00.000Z",
  endTime: "2026-12-01T11:00:00.000Z",
  depositAmount: 50,
  paymentMethod: "stripe",
  guestName: "Anna Gosc",
  guestPhone: "500600700",
};

const DEPOSITS_DISABLED_BODY = {
  success: false,
  code: "DEPOSIT_NOT_APPLICABLE",
  reason: "DEPOSITS_DISABLED",
  error: "Zadatek nie jest wymagany dla tej rezerwacji",
};

function post(body: unknown = validBody) {
  return createSession(
    createMockRequest("http://localhost:3000/api/deposits/create-session", { method: "POST", body })
  );
}

function expectNothingTouched() {
  expect(h.getStripe).not.toHaveBeenCalled();
  expect(h.sessionsCreate).not.toHaveBeenCalled();
  expect(h.dbCall).not.toHaveBeenCalled();
  expect(h.calcDeposit).not.toHaveBeenCalled();
  expect(h.assertSalonRefs).not.toHaveBeenCalled();
  expect(h.getOptionalSession).not.toHaveBeenCalled();
  expect(h.getSalonContext).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimitCheck.mockReturnValue({ success: true, remaining: 4, reset: 60_000 });
  // Najgorszy przypadek: klucz płatności kartą skonfigurowany, Checkout odpowiada.
  h.isStripeConfigured.mockReturnValue(true);
  h.getStripe.mockReturnValue({ checkout: { sessions: { create: h.sessionsCreate } } });
  h.sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.example.invalid/cs_test_1" });
  h.getOptionalSession.mockResolvedValue(null);
  h.getSalonContext.mockResolvedValue(null);
  // Wiersz z flagą zapisaną wcześniej: wyliczenie dałoby zadatek 50 PLN.
  h.calcDeposit.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
  h.assertSalonRefs.mockResolvedValue(null);
});

describe("POST /api/deposits/create-session — zadatek wyłączony", () => {
  it("gość, usługa z zadatkiem, klucz płatności skonfigurowany → 400 DEPOSIT_NOT_APPLICABLE, dostawca płatności niewołany", async () => {
    const { status, body } = await parseResponse(await post());

    expect(status).toBe(400);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expectNothingTouched();
  });

  it("zalogowany klient portalu → 400, bez odczytu sesji i bez dostawcy płatności", async () => {
    h.getOptionalSession.mockResolvedValue({ user: { id: "u-1", email: "klient@example.invalid" } });

    const { status, body } = await parseResponse(await post());

    expect(status).toBe(400);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expectNothingTouched();
  });

  it("personel salonu → 400 (bez wyjątku dla personelu)", async () => {
    h.getOptionalSession.mockResolvedValue({ user: { id: "owner-1", email: "owner@example.invalid" } });
    h.getSalonContext.mockResolvedValue({ salonId: SALON_UUID, role: "owner", employeeId: null, userId: "owner-1" });

    const { status } = await parseResponse(await post());

    expect(status).toBe(400);
    expectNothingTouched();
  });

  it("niepoprawne body → nadal 400 DEPOSIT_NOT_APPLICABLE (bramka przed walidacją, nic nie jest czytane)", async () => {
    const { status, body } = await parseResponse(await post({ salonId: "nie-uuid" }));

    expect(status).toBe(400);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expectNothingTouched();
  });

  it("puste body → 400 DEPOSIT_NOT_APPLICABLE", async () => {
    const { status, body } = await parseResponse(await post({}));

    expect(status).toBe(400);
    expect(body).toEqual(DEPOSITS_DISABLED_BODY);
    expectNothingTouched();
  });

  it("nigdy 409 — front mapuje 409 na „termin zajęty”", async () => {
    const { status } = await parseResponse(await post());

    expect(status).not.toBe(409);
  });

  it("limit żądań przekroczony → 429 z Retry-After (limit przed bramką, bez zmian)", async () => {
    h.rateLimitCheck.mockReturnValue({ success: false, remaining: 0, reset: 30_000 });

    const response = await post();
    const { status } = await parseResponse(response);

    expect(status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expectNothingTouched();
  });

  it("klucz płatności nieskonfigurowany → 400, nie 503 STRIPE_UNAVAILABLE", async () => {
    h.isStripeConfigured.mockReturnValue(false);

    const { status, body } = await parseResponse(await post());

    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(h.isStripeConfigured).not.toHaveBeenCalled();
  });
});

describe("kontrakt z portalem — odpowiedź trasy przez isDepositNotApplicable", () => {
  // Payload budowany tą samą funkcją, której używa formularz portalu.
  const portalBody = (isLoggedIn: boolean) =>
    buildDepositBody({
      salonId: SALON_UUID,
      employeeId: EMPLOYEE_UUID,
      serviceId: SERVICE_UUID,
      variantId: "",
      startTime: new Date("2026-12-01T10:00:00.000Z"),
      endTime: new Date("2026-12-01T11:00:00.000Z"),
      notes: "",
      depositAmount: 50,
      paymentMethod: "stripe",
      isLoggedIn,
      guestName: "Anna Gosc",
      guestPhone: "500 600 700",
      guestEmail: "",
    });

  it("gość: portal rozpoznaje odpowiedź i przechodzi na zwykłą rezerwację", async () => {
    const res = await post(portalBody(false));
    const json: unknown = await res.json();

    expect(isDepositNotApplicable(res.status, json)).toBe(true);
    expectNothingTouched();
  });

  it("zalogowany klient: portal rozpoznaje odpowiedź i przechodzi na zwykłą rezerwację", async () => {
    h.getOptionalSession.mockResolvedValue({ user: { id: "u-1", email: "klient@example.invalid" } });

    const res = await post(portalBody(true));
    const json: unknown = await res.json();

    expect(isDepositNotApplicable(res.status, json)).toBe(true);
  });

  it("limit żądań (429) nie jest mylony z brakiem zadatku", async () => {
    h.rateLimitCheck.mockReturnValue({ success: false, remaining: 0, reset: 30_000 });

    const res = await post(portalBody(false));
    const json: unknown = await res.json();

    expect(isDepositNotApplicable(res.status, json)).toBe(false);
  });
});

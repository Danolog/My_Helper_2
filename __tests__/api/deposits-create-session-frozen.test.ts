/**
 * POST /api/deposits/create-session jest zamrożony modułem
 * `onlineDeposits` — odmowa samej trasy, druga linia obrony obok proxy.
 *
 * Prawdziwe `@/lib/features` i `@/lib/server/frozen-guard` (bez atrapy
 * strażnika). Atrapy-szpiedzy: limit, sesja, baza, Stripe, wyliczenie
 * zadatku. Każdy z siedmiu przypadków (ciało poprawne i błędne, brak sesji,
 * limit, brak salonu, błąd bazy) daje teraz 404 MODULE_DISABLED, a żaden
 * szpieg nie jest wywołany — strażnik stoi przed limitem, sesją i bazą.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDepositBody } from "@/app/(client)/salons/[id]/book/_lib/deposit-body";
// vi.mock niżej jest wynoszony nad importy — trasa ładuje się już z atrapami.
import { POST } from "@/app/api/deposits/create-session/route";
import { MODULE_DISABLED_CODE, MODULE_DISABLED_MESSAGE } from "@/lib/features";
import { createMockRequest, parseResponse } from "./helpers";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const MISSING_SALON_UUID = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";
const URL = "http://localhost:3000/api/deposits/create-session";

// -------------------------------------------------------
// Szpiedzy
// -------------------------------------------------------

const h = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
  dbDelete: vi.fn(),
  dbTransaction: vi.fn(),
  getOptionalSession: vi.fn(),
  rateLimitCheck: vi.fn(),
  getClientIp: vi.fn(),
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(),
  calculateExpectedDeposit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => h.dbSelect(...a),
    insert: (...a: unknown[]) => h.dbInsert(...a),
    update: (...a: unknown[]) => h.dbUpdate(...a),
    delete: (...a: unknown[]) => h.dbDelete(...a),
    transaction: (...a: unknown[]) => h.dbTransaction(...a),
  },
}));

vi.mock("@/lib/session", () => ({
  getOptionalSession: (...a: unknown[]) => h.getOptionalSession(...a),
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: (...a: unknown[]) => h.rateLimitCheck(...a) },
  getClientIp: (...a: unknown[]) => h.getClientIp(...a),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => h.getStripe(...a),
  isStripeConfigured: (...a: unknown[]) => h.isStripeConfigured(...a),
}));

vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: (...a: unknown[]) => h.calculateExpectedDeposit(...a),
}));

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

function validBody(salonId: string = SALON_UUID) {
  const startTime = new Date("2026-12-01T10:00:00.000Z");
  return buildDepositBody({
    salonId,
    employeeId: EMPLOYEE_UUID,
    serviceId: SERVICE_UUID,
    variantId: "",
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60000),
    notes: "Rezerwacja online: Strzyzenie",
    depositAmount: 50,
    paymentMethod: "stripe",
    isLoggedIn: true,
    guestName: "",
    guestPhone: "",
    guestEmail: "",
  });
}

function post(body: unknown) {
  return POST(createMockRequest(URL, { method: "POST", body }));
}

/** Żądanie z ciałem, które nie jest poprawnym JSON-em. */
function postRaw(raw: string) {
  return POST(
    new Request(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw })
  );
}

/** Atrapy w stanie otwartej trasy: limit wolny, sesja klienta, wyliczony zadatek. */
function primeOpenRoute() {
  h.rateLimitCheck.mockReturnValue({ success: true, remaining: 4, reset: 60000 });
  h.getClientIp.mockReturnValue("127.0.0.1");
  h.getOptionalSession.mockResolvedValue({ user: { id: "user-1", email: "klient@test.pl", name: "Klient" } });
  h.isStripeConfigured.mockReturnValue(false);
  h.getStripe.mockReturnValue(null);
  h.calculateExpectedDeposit.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
}

async function expectModuleDisabled(res: Response) {
  const { status, body } = await parseResponse(res);
  expect(status).toBe(404);
  expect(body).toEqual({
    success: false,
    code: MODULE_DISABLED_CODE,
    error: MODULE_DISABLED_MESSAGE,
  });
  // Kod modułu, nie NOT_FOUND / VALIDATION — i dokładny tekst dla użytkownika.
  expect(body.code).toBe("MODULE_DISABLED");
  expect(body.error).toBe("Ta funkcja jest obecnie niedostępna.");
}

function expectNothingTouched() {
  expect(h.rateLimitCheck).not.toHaveBeenCalled();
  expect(h.getClientIp).not.toHaveBeenCalled();
  expect(h.getOptionalSession).not.toHaveBeenCalled();
  expect(h.dbSelect).not.toHaveBeenCalled();
  expect(h.dbInsert).not.toHaveBeenCalled();
  expect(h.dbUpdate).not.toHaveBeenCalled();
  expect(h.dbDelete).not.toHaveBeenCalled();
  expect(h.dbTransaction).not.toHaveBeenCalled();
  expect(h.getStripe).not.toHaveBeenCalled();
  expect(h.isStripeConfigured).not.toHaveBeenCalled();
  expect(h.calculateExpectedDeposit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  primeOpenRoute();
});

describe(
  "POST /api/deposits/create-session zamrożony modułem onlineDeposits — " +
    "403 nie dotyczy tej trasy, bo jest publiczna (gość i klient portalu)",
  () => {
    it("poprawne ciało + sesja → 404 MODULE_DISABLED", async () => {
      await expectModuleDisabled(await post(validBody()));
      expectNothingTouched();
    });

    it("niepoprawny JSON → 404 MODULE_DISABLED", async () => {
      await expectModuleDisabled(await postRaw("{nie-json"));
      expectNothingTouched();
    });

    it("brak wymaganych pól (bez zamrożenia: 400) → 404 MODULE_DISABLED", async () => {
      await expectModuleDisabled(await post({}));
      expectNothingTouched();
    });

    it("brak sesji → 404 MODULE_DISABLED", async () => {
      h.getOptionalSession.mockResolvedValue(null);
      await expectModuleDisabled(await post(validBody()));
      expectNothingTouched();
    });

    it("limit wyczerpany (bez zamrożenia: 429) → 404 MODULE_DISABLED, bez nagłówka Retry-After", async () => {
      h.rateLimitCheck.mockReturnValue({ success: false, remaining: 0, reset: 60000 });
      const res = await post(validBody());
      expect(res.headers.get("Retry-After")).toBeNull();
      await expectModuleDisabled(res);
      expectNothingTouched();
    });

    it("salon nieistniejący → 404 z kodem modułu", async () => {
      h.calculateExpectedDeposit.mockResolvedValue({ ok: false });
      await expectModuleDisabled(await post(validBody(MISSING_SALON_UUID)));
      expectNothingTouched();
    });

    it("baza rzuca → 404 MODULE_DISABLED", async () => {
      const boom = () => {
        throw new Error("db down");
      };
      h.dbSelect.mockImplementation(boom);
      h.dbInsert.mockImplementation(boom);
      h.dbTransaction.mockImplementation(boom);
      await expectModuleDisabled(await post(validBody()));
      expectNothingTouched();
    });
  }
);

/**
 * Luka D (P1 logi, zakres z audytu bezpieczeństwa T3): POST /api/deposits/create-session przy
 * błędzie Stripe Checkout loguje tylko tożsamość błędu i pola Stripe bez
 * wartości — nigdy `message` (Stripe wkleja tam e-mail gościa z
 * `customer_email`) ani params Drizzle (ten sam catch łapie zapis cs_ po
 * udanej sesji).
 *
 * PRAWDZIWY logger, bez mocka (mock pomija redakcję) — szpieg na
 * console.error, oba tryby loggera: production (JSON) i development (obiekt →
 * util.inspect na pełną głębokość). `isProduction` jest stałą modułu
 * loggera, więc trasa jest importowana na nowo po `vi.resetModules()` —
 * dlatego osobny plik, nie blok w deposits-create-session.test.ts (tamtejsze
 * szpiegi na `logger` trzymają instancję z importu statycznego).
 * Mutant M3 (powrót do `stripeError.message`) → czerwone.
 */
import { inspect } from "node:util";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChainMock, createMockRequest } from "./helpers";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_UUID = "66666666-6666-4666-8666-666666666666";
const DEPOSIT_PAYMENT_UUID = "77777777-7777-4777-8777-777777777777";

const SENTINEL_EMAIL = "wartownik@test.invalid";
const SENTINEL_NAME = "Wartownik-Imie";
const SENTINEL_PHONE = "+48600111222";
const SENTINEL_NOTE = "WARTOWNIK-NOTATKA";

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockTx = {
  select: (...a: unknown[]) => mockDbSelect(...a),
  insert: (...a: unknown[]) => mockDbInsert(...a),
  update: (...a: unknown[]) => mockDbUpdate(...a),
  delete: (...a: unknown[]) => mockDbDelete(...a),
};
vi.mock("@/lib/db", () => ({
  db: { ...mockTx, transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx) },
}));

// Gość bez konta: e-mail do Checkout pochodzi z ciała żądania.
vi.mock("@/lib/session", () => ({ getOptionalSession: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }) },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: vi.fn().mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" }),
}));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: vi.fn().mockResolvedValue(null) }));

const mockSessionsCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ checkout: { sessions: { create: (...a: unknown[]) => mockSessionsCreate(...a) } } }),
}));
// Rejestr mocków przetrwa vi.resetModules() w runInMode — trasa importowana na nowo też dostaje ten mock.
vi.mock("@/lib/server/frozen-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/frozen-guard")>()),
  frozenModuleResponse: () => null, // trasa testowana bez blokady modułu
}));
// Trasa testowana tak, jak zadziała po włączeniu zadatku (isDepositEnabled).
// Dzisiejszy stan (400 DEPOSIT_NOT_APPLICABLE): __tests__/api/deposits-disabled.test.ts.
vi.mock("@/lib/features", async (orig) => ({
  ...(await orig<typeof import("@/lib/features")>()),
  isDepositEnabled: () => true,
}));

const guestBody = {
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  startTime: "2026-08-01T10:00:00.000Z",
  endTime: "2026-08-01T11:00:00.000Z",
  depositAmount: 50,
  paymentMethod: "stripe",
  guestName: SENTINEL_NAME,
  guestPhone: SENTINEL_PHONE,
  guestEmail: SENTINEL_EMAIL,
  notes: SENTINEL_NOTE,
};

/**
 * Prawdziwa klasa błędu z SDK stripe (uwaga z recenzji do #191): w SDK `type` to
 * nazwa klasy, a typ z API leży w `rawType` — atrapa z `type =
 * "invalid_request_error"` ukryła, że trasa logowała nazwę klasy jako typ.
 * Importowana PO `vi.resetModules()` (w `runInMode`), żeby `instanceof` w
 * trasie widział tę samą klasę.
 */
async function stripeInvalidEmail() {
  const { default: Stripe } = await import("stripe");
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message: `Invalid email address: ${SENTINEL_EMAIL}`,
    code: "email_invalid",
    param: "customer_email",
    requestId: "req_test_123",
  } as never);
}

function primeDb() {
  mockDbSelect.mockReturnValueOnce(createChainMock([])).mockReturnValueOnce(createChainMock([]));
  mockDbInsert
    .mockReturnValueOnce(createChainMock([{ id: APPOINTMENT_UUID, salonId: SALON_UUID, status: "scheduled" }]))
    .mockReturnValueOnce(createChainMock([{ id: DEPOSIT_PAYMENT_UUID, appointmentId: APPOINTMENT_UUID, status: "pending" }]));
  mockDbUpdate.mockReturnValue(createChainMock([]));
  mockDbDelete.mockReturnValue(createChainMock([]));
}

/** Trasa z loggerem w danym trybie; zwraca status i całe wyjście console.error. */
async function runInMode(mode: "production" | "development", prepare?: () => Promise<void>) {
  vi.stubEnv("NODE_ENV", mode);
  vi.resetModules();
  const { POST } = await import("@/app/api/deposits/create-session/route");
  await prepare?.();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await POST(
      createMockRequest("http://localhost:3000/api/deposits/create-session", { method: "POST", body: guestBody })
    );
    const out = spy.mock.calls
      .map((args) => args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: null }))).join(" "))
      .join("\n");
    return { status: res.status, out };
  } finally {
    spy.mockRestore();
  }
}

function expectNoSentinels(out: string) {
  for (const s of [SENTINEL_EMAIL, SENTINEL_NAME, SENTINEL_PHONE, SENTINEL_NOTE]) {
    expect(out, s).not.toContain(s);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  primeDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(["production", "development"] as const)("luka D, logger w trybie %s", (mode) => {
  it("Stripe odrzuca e-mail → 502, wizyta usunięta; w logu type/code/param/requestId i identyfikatory, bez e-maila", async () => {
    const { status, out } = await runInMode(mode, async () => {
      mockSessionsCreate.mockRejectedValue(await stripeInvalidEmail());
    });

    expect(status).toBe(502);
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
    // Do Stripe e-mail idzie (to nie jest luka), do logu — nie.
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ customer_email: SENTINEL_EMAIL }));
    expect(out).toContain("Stripe Checkout session creation failed for deposit");
    expectNoSentinels(out);
    expect(out).not.toContain("Invalid email address");
    for (const v of [
      "StripeInvalidRequestError",
      "invalid_request_error",
      "email_invalid",
      "customer_email",
      "req_test_123",
      APPOINTMENT_UUID,
      DEPOSIT_PAYMENT_UUID,
    ]) {
      expect(out, v).toContain(v);
    }
  });

  it("zapis cs_ po udanej sesji rzuca DrizzleQueryError z danymi gościa → 502; w logu nazwa i kod, bez params/detail/zapytania", async () => {
    mockSessionsCreate.mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" });
    const pgCause = Object.assign(new Error(`value too long for type: ${SENTINEL_NAME}`), {
      code: "22001",
      detail: `Key (phone)=(${SENTINEL_PHONE})`,
    });
    const err = new DrizzleQueryError(
      "update deposit_payments set stripe_payment_intent_id = $1",
      [SENTINEL_NAME, SENTINEL_PHONE, SENTINEL_EMAIL],
      pgCause
    );
    const failing = createChainMock([]) as Record<string, unknown>;
    failing.then = (_res: unknown, reject: (e: unknown) => unknown) => reject(err);
    mockDbUpdate.mockReset();
    mockDbUpdate.mockReturnValueOnce(failing);

    const { status, out } = await runInMode(mode);

    expect(status).toBe(502);
    expectNoSentinels(out);
    for (const s of ["params", "Key (phone)", "update deposit_payments", "value too long"]) {
      expect(out, s).not.toContain(s);
    }
    expect(out).toContain("DrizzleQueryError");
    expect(out).toContain("22001");
    // Pola Stripe tylko dla błędów SDK Stripe — błąd bazy z `code` ich nie dostaje.
    expect(out).not.toMatch(/stripe(Type|Code|Param|RequestId)/);
  });

  it("stripeType = rawType z API, nie nazwa klasy z SDK", async () => {
    const { out } = await runInMode(mode, async () => {
      mockSessionsCreate.mockRejectedValue(await stripeInvalidEmail());
    });
    expect(out).toMatch(/stripeType["']?:\s*["']invalid_request_error["']/);
    expect(out).not.toMatch(/stripeType["']?:\s*["']StripeInvalidRequestError["']/);
    expect(out).toMatch(/stripeCode["']?:\s*["']email_invalid["']/);
    expect(out).toMatch(/stripeParam["']?:\s*["']customer_email["']/);
  });

  it("obiekt spoza SDK Stripe z polami type/code/param → bez pól stripe* w logu", async () => {
    mockSessionsCreate.mockRejectedValue(
      Object.assign(new Error("boom"), { type: "invalid_request_error", code: "email_invalid", param: "customer_email", requestId: "req_x" })
    );
    const { status, out } = await runInMode(mode);
    expect(status).toBe(502);
    expect(out).not.toMatch(/stripe(Type|Code|Param|RequestId)/);
    expect(out).toContain("email_invalid"); // errorCode z toErrorIdentity zostaje
  });
});

it("rzucony napis zamiast błędu (bez pól Stripe) → 502, w logu tylko errorName, bez treści", async () => {
  mockSessionsCreate.mockRejectedValue(`Invalid email address: ${SENTINEL_EMAIL}`);
  const { status, out } = await runInMode("production");
  expect(status).toBe(502);
  expectNoSentinels(out);
  expect(out).toContain('"errorName":"string"');
  expect(out).not.toContain("stripeType");
});

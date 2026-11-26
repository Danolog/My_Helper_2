/**
 * Tests for POST /api/deposits/create-session.
 *
 * The route recomputes the deposit amount SERVER-SIDE (via
 * calculateExpectedDeposit — the body amount is only cross-checked),
 * validates the slot, creates appointment + pending deposit payment in one
 * transaction, and then:
 * - Stripe configured  -> creates a REAL Stripe Checkout session
 *   (mode "payment", card/BLIK/P24, amount in grosze, metadata.kind
 *   "deposit") and returns its URL as `paymentUrl`.
 * - Stripe NOT configured -> returns the dev simulation payload
 *   (`simulated: true`) so the frontend can confirm via /api/deposits/confirm.
 * - Stripe configured but session creation fails -> 502 and the just-created
 *   appointment is deleted so the slot is not blocked by an unpayable booking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSalonContext } from "@/lib/salon-context";
import { getOptionalSession } from "@/lib/session";
import { TEST_PHONE } from "@/lib/test-phone";
import {
  createMockRequest,
  parseResponse,
  createChainMock,
} from "./helpers";
import { sqlMatches } from "./sql-predicate";
import { deadlock, wrapped } from "./deadlock-fixture";

// Zod 4's z.string().uuid() enforces RFC 4122 version/variant nibbles, so the
// simple TEST_IDS placeholders (all-1s etc.) do not pass — use valid v4 UUIDs.
const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_UUID = "66666666-6666-4666-8666-666666666666";
const CLIENT_UUID = "33333333-3333-4333-8333-333333333333";

// -------------------------------------------------------
// Mocks - must be declared before importing the route
// -------------------------------------------------------

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
  db: {
    select: (...a: unknown[]) => mockDbSelect(...a),
    insert: (...a: unknown[]) => mockDbInsert(...a),
    update: (...a: unknown[]) => mockDbUpdate(...a),
    delete: (...a: unknown[]) => mockDbDelete(...a),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn().mockResolvedValue({
    user: { id: "test-user-id", email: "klient@test.pl", name: "Test User" },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: {
    check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }),
  },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// Server-side deposit amount calculation (tested separately in
// __tests__/lib/deposit-calculation.test.ts)
const mockCalcDeposit = vi.fn();
vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: (...a: unknown[]) => mockCalcDeposit(...a),
}));

// Kontekst salonu: domyślna sesja to klient portalu (nie personel).
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn().mockResolvedValue(null),
}));

// Przynależność refów do salonu testowana w deposits-create-session-refs.test.ts
// (prawdziwy assertSalonRefs); tu tylko spy, domyślnie "wszystko z salonu".
const mockAssertSalonRefs = vi.fn();
vi.mock("@/lib/salon-refs", () => ({
  assertSalonRefs: (...a: unknown[]) => mockAssertSalonRefs(...a),
}));

const mockGetStripe = vi.fn();
const mockIsStripeConfigured = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripeConfigured: (...a: unknown[]) => mockIsStripeConfigured(...a),
}));

vi.mock("@/lib/server/frozen-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/frozen-guard")>()),
  frozenModuleResponse: () => null, // trasa testowana bez blokady modułu
}));

// Trasa testowana tak, jak zadziała po włączeniu zadatku (isDepositEnabled).
// Dzisiejszy stan (409 DEPOSITS_DISABLED): __tests__/api/deposits-disabled.test.ts.
vi.mock("@/lib/features", async (orig) => ({
  ...(await orig<typeof import("@/lib/features")>()),
  isDepositEnabled: () => true,
}));

import { POST as createSession } from "@/app/api/deposits/create-session/route";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

const DEPOSIT_PAYMENT_UUID = "77777777-7777-4777-8777-777777777777";

const validBody = {
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  startTime: "2026-08-01T10:00:00.000Z",
  endTime: "2026-08-01T11:00:00.000Z",
  depositAmount: 50,
  paymentMethod: "stripe",
  notes: "Rezerwacja online: Strzyzenie",
};

const insertedAppointment = {
  id: APPOINTMENT_UUID,
  salonId: SALON_UUID,
  employeeId: EMPLOYEE_UUID,
  serviceId: SERVICE_UUID,
  status: "scheduled",
  depositPaid: false,
};

const insertedPayment = {
  id: DEPOSIT_PAYMENT_UUID,
  appointmentId: APPOINTMENT_UUID,
  salonId: SALON_UUID,
  amount: "50",
  currency: "PLN",
  paymentMethod: "stripe",
  status: "pending",
};

/** Queue the SELECTs (overlap, time blocks) + two INSERTs (tx). */
function primeHappyPathDb() {
  mockDbSelect
    .mockReturnValueOnce(createChainMock([])) // overlapping appointments
    .mockReturnValueOnce(createChainMock([])); // time blocks
  mockDbInsert
    .mockReturnValueOnce(createChainMock([insertedAppointment]))
    .mockReturnValueOnce(createChainMock([insertedPayment]));
  mockDbUpdate.mockReturnValue(createChainMock([]));
  mockDbDelete.mockReturnValue(createChainMock([]));
}

function primeExpectedDeposit(amount = 50) {
  mockAssertSalonRefs.mockResolvedValue(null);
  mockCalcDeposit.mockResolvedValue({
    ok: true,
    required: true,
    amount,
    serviceName: "Strzyzenie",
  });
}

function makeRequest(body: Record<string, unknown> = validBody) {
  return createMockRequest("http://localhost:3000/api/deposits/create-session", {
    method: "POST",
    body,
  });
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

// #69: flaga symulacji nie przecieka między testami.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/deposits/create-session — Stripe configured", () => {
  const mockSessionsCreate = vi.fn();
  const fakeStripe = {
    checkout: { sessions: { create: (...a: unknown[]) => mockSessionsCreate(...a) } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPathDb();
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripe);
    mockSessionsCreate.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
  });

  it("creates a real Checkout session and returns its URL as paymentUrl", async () => {
    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{
      success: boolean;
      data: Record<string, unknown>;
    }>(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe("cs_test_123");
    expect(body.data.paymentUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(body.data.simulated).toBe(false);
    expect(body.data.depositPaymentId).toBe(DEPOSIT_PAYMENT_UUID);
    expect(body.data.appointmentId).toBe(APPOINTMENT_UUID);
    // The server-side calculation was consulted
    expect(mockCalcDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: SALON_UUID,
        serviceId: SERVICE_UUID,
        sessionUser: expect.objectContaining({ email: "klient@test.pl" }),
      })
    );
  });

  it("configures the session for PLN deposits: mode payment, card/BLIK/P24, grosze, deposit metadata", async () => {
    await createSession(makeRequest());

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0]![0] as Record<string, any>;

    expect(args.mode).toBe("payment");
    expect(args.payment_method_types).toEqual(["card", "blik", "p24"]);
    expect(args.line_items[0].price_data.currency).toBe("pln");
    // 50 PLN -> 5000 groszy
    expect(args.line_items[0].price_data.unit_amount).toBe(5000);
    expect(args.line_items[0].price_data.product_data.name).toContain("Strzyzenie");
    expect(args.metadata).toEqual({
      kind: "deposit",
      depositPaymentId: DEPOSIT_PAYMENT_UUID,
      appointmentId: APPOINTMENT_UUID,
      salonId: SALON_UUID,
    });
    // ~30 min expiry
    const now = Math.floor(Date.now() / 1000);
    expect(args.expires_at).toBeGreaterThan(now + 25 * 60);
    expect(args.expires_at).toBeLessThan(now + 45 * 60);
    // Redirects back to the booking portal with a deposit result param
    expect(args.success_url).toContain(`/salons/${SALON_UUID}/book?deposit=success`);
    expect(args.cancel_url).toContain(`/salons/${SALON_UUID}/book?deposit=cancelled`);

    // The Checkout session id is persisted on the deposit payment record
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a manipulated deposit amount with 400 (server-side amount wins)", async () => {
    // Server says 50 PLN, the request claims 0.01 PLN
    const response = await createSession(
      makeRequest({ ...validBody, depositAmount: 0.01 })
    );
    const { status, body } = await parseResponse<{ success: boolean; error: string }>(
      response
    );

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("kwota zadatku");
    // Nothing was created, Stripe never touched
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects when no deposit is required for this booking", async () => {
    mockCalcDeposit.mockResolvedValue({
      ok: true,
      required: false,
      amount: 0,
      serviceName: "Strzyzenie",
    });

    const response = await createSession(makeRequest());
    const { status } = await parseResponse(response);

    expect(status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // P1 (audyt bezpieczeństwa): klient portalu nie podpina rekordu klienta — clientId z body
  // jest ignorowany (null do assertSalonRefs i do wizyty).
  it("ignores a clientId sent by a portal client (non-staff)", async () => {
    const response = await createSession(
      makeRequest({ ...validBody, clientId: CLIENT_UUID })
    );

    expect(response.status).toBe(201);
    expect(mockAssertSalonRefs).toHaveBeenCalledWith(SALON_UUID, {
      clientId: null,
      employeeId: EMPLOYEE_UUID,
      serviceId: SERVICE_UUID,
    });
  });

  it("returns 502 and deletes the appointment when Checkout creation fails", async () => {
    mockSessionsCreate.mockRejectedValue(new Error("stripe down"));

    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{ success: boolean }>(response);

    expect(status).toBe(502);
    expect(body.success).toBe(false);
    // The unpayable appointment must not keep blocking the slot
    expect(mockDbDelete).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/deposits/create-session — Stripe NOT configured (dev simulation)", () => {
  beforeEach(() => {
    // #69: symulacja bez klucza Stripe jest opt-in (vitest: NODE_ENV=test).
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    vi.clearAllMocks();
    primeHappyPathDb();
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(null);
  });

  it("falls back to the simulated dev session", async () => {
    const response = await createSession(makeRequest());
    const { status, body } = await parseResponse<{
      success: boolean;
      data: Record<string, unknown>;
    }>(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.simulated).toBe(true);
    expect(body.data.sessionId).toBe(`dep_session_${DEPOSIT_PAYMENT_UUID}`);
    expect(body.data.paymentUrl).toBe(
      `/api/deposits/checkout?session=dep_session_${DEPOSIT_PAYMENT_UUID}`
    );
  });

  it("rejects a taken slot with 409 before creating anything", async () => {
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValueOnce(
      createChainMock([{ id: "existing-appointment" }]) // overlap found
    );

    const response = await createSession(makeRequest());
    const { status } = await parseResponse(response);

    expect(status).toBe(409);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/deposits/create-session — kolizja półotwarta (#165)", () => {
  // Rezerwacja z validBody: 10:00–11:00Z. Wiersze przechodzą przez WHERE trasy.
  function filteringChain(rows: Record<string, unknown>[]) {
    const c = createChainMock([]);
    let where: unknown;
    c.where = vi.fn((w: unknown) => {
      where = w;
      return c;
    });
    c.then = (resolve: (v: unknown[]) => unknown) =>
      resolve(rows.filter((r) => sqlMatches(where as Parameters<typeof sqlMatches>[0], r)));
    return c;
  }
  const appt = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    employee_id: EMPLOYEE_UUID,
    status: "scheduled",
    start_time: new Date(`2026-08-01T${start}:00.000Z`),
    end_time: new Date(`2026-08-01T${end}:00.000Z`),
    ...extra,
  });
  const block = (start: string, end: string) => ({
    id: "block-165",
    employee_id: EMPLOYEE_UUID,
    start_time: new Date(`2026-08-01T${start}:00.000Z`),
    end_time: new Date(`2026-08-01T${end}:00.000Z`),
  });

  beforeEach(() => {
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbInsert
      .mockReturnValueOnce(createChainMock([insertedAppointment]))
      .mockReturnValueOnce(createChainMock([insertedPayment]));
    mockDbUpdate.mockReturnValue(createChainMock([]));
    mockDbDelete.mockReturnValue(createChainMock([]));
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(null);
  });

  function prime(rows: Record<string, unknown>[], blocks: Record<string, unknown>[] = []) {
    mockDbSelect.mockReturnValueOnce(filteringChain(rows)).mockReturnValueOnce(filteringChain(blocks));
  }

  it("styk: wizyta 09–10, rezerwacja 10–11 → 201", async () => {
    prime([appt("09:00", "10:00")]);
    expect((await createSession(makeRequest())).status).toBe(201);
  });

  it("styk z drugiej strony: wizyta 11–12 → 201", async () => {
    prime([appt("11:00", "12:00")]);
    expect((await createSession(makeRequest())).status).toBe(201);
  });

  it("nakładanie o 1 minutę → 409 z dotychczasowym komunikatem, nic nie zapisane", async () => {
    prime([appt("10:59", "12:00")]);
    const { status, body } = await parseResponse<{ error: string }>(await createSession(makeRequest()));
    expect(status).toBe(409);
    expect(body.error).toBe("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("anulowana wizyta w tym samym terminie nie koliduje → 201", async () => {
    prime([appt("10:00", "11:00", { status: "cancelled" })]);
    expect((await createSession(makeRequest())).status).toBe(201);
  });

  it("wizyta z zadatkiem w toku (scheduled, nieopłacona) blokuje → 409", async () => {
    prime([appt("10:30", "11:30", { status: "scheduled", deposit_paid: false })]);
    expect((await createSession(makeRequest())).status).toBe(409);
  });

  it("blokada czasu na styku (11–12) → 201", async () => {
    prime([], [block("11:00", "12:00")]);
    expect((await createSession(makeRequest())).status).toBe(201);
  });

  // Q8 (#168): urlop jednego pracownika nie blokuje rezerwacji u innego.
  it("blokada INNEGO pracownika w tym samym terminie → 201, wizyta i płatność zapisane", async () => {
    prime([], [{ ...block("10:00", "11:00"), employee_id: "22222222-2222-4222-8222-999999999999" }]);
    expect((await createSession(makeRequest())).status).toBe(201);
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });

  it("kontrast Q8: ta sama blokada u wybranego pracownika → 409, nic nie zapisane", async () => {
    prime([], [block("10:00", "11:00")]);
    expect((await createSession(makeRequest())).status).toBe(409);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  function rejectingInsert(cause: Record<string, unknown>) {
    const chain = createChainMock([]) as Record<string, unknown>;
    chain.then = (_res: unknown, reject: (e: unknown) => unknown) =>
      reject(Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("db"), cause) }));
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValueOnce(chain);
  }

  it("#171: baza odrzuca wizytę (23P01, wyścig) → 409 z dotychczasowym komunikatem, bez płatności", async () => {
    prime([]);
    rejectingInsert({ code: "23P01", constraint_name: "appointments_no_overlap" });
    const res = await createSession(makeRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expect(mockDbInsert).toHaveBeenCalledTimes(1); // płatność zadatku nie zapisana
  });

  it("#171: inny błąd zapisu wizyty → 500", async () => {
    prime([]);
    rejectingInsert({ code: "23514", constraint_name: "appointments_end_after_start" });
    expect((await createSession(makeRequest())).status).toBe(500);
  });

  /** Spy na logger.error (prawdziwy albo zamockowany moduł) — 500 ma trafić do logu z kodem błędu. */
  async function spyLoggerError() {
    const { logger } = await import("@/lib/logger");
    return vi.spyOn(logger, "error");
  }

  /** Zapis wizyty odrzucony błędem `err` (kształt Drizzle); zwraca status i treść. */
  async function depositRejected(err: Error) {
    prime([]);
    const chain = createChainMock([]) as Record<string, unknown>;
    chain.then = (_res: unknown, reject: (e: unknown) => unknown) => reject(err);
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValueOnce(chain);
    const res = await createSession(makeRequest());
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }

  it("zadatek: 40P01 przy sprawdzaniu EXCLUDE (zakleszczenie, db71a43) → 409 z komunikatem kolizji", async () => {
    const { status, body } = await depositRejected(wrapped(deadlock()));
    expect(status).toBe(409);
    expect(body.error).toBe("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expect(mockDbInsert).toHaveBeenCalledTimes(1); // płatność zadatku nie zapisana
  });

  it.each([
    ["40P01 bez kontekstu", "40P01", deadlock(null)],
    ["40P01 innej relacji", "40P01", deadlock('while checking exclusion constraint on tuple (1,2) in relation "payments"')],
    ["40001 z kontekstem EXCLUDE", "40001", { ...deadlock(), code: "40001" }],
  ])("zadatek: %s → 500, w logu kod błędu", async (_n, code, cause) => {
    const spy = await spyLoggerError();
    const { status } = await depositRejected(wrapped(cause));
    expect(status).toBe(500);
    expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
    spy.mockRestore();
  });

  it("endTime = startTime → 400, bez zapytań o kolizje i zapisu", async () => {
    const res = await createSession(makeRequest({ ...validBody, endTime: validBody.startTime }));
    expect(res.status).toBe(400);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("blokada czasu nachodząca o 1 minutę → 409", async () => {
    prime([], [block("10:59", "12:00")]);
    const { status, body } = await parseResponse<{ error: string }>(await createSession(makeRequest()));
    expect(status).toBe(409);
    expect(body.error).toBe("Pracownik nie jest dostepny w wybranym terminie.");
  });
});

describe("POST /api/deposits/create-session — bookedByUserId i e-mail Stripe (#193)", () => {
  const STAFF_USER_ID = "staff-user-193";
  const STAFF_EMAIL = "staff-193@example.invalid";
  const PORTAL_USER_ID = "portal-user-193";
  const PORTAL_EMAIL = "portal-193@example.invalid";
  const GUEST_EMAIL = "guest-193@example.invalid";
  const mockSessionsCreate = vi.fn();
  const fakeStripe = {
    checkout: { sessions: { create: (...a: unknown[]) => mockSessionsCreate(...a) } },
  };
  let appointmentChain: ReturnType<typeof createChainMock>;

  function appointmentValues(): Record<string, unknown> {
    return (appointmentChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
  }
  function stripeArgs(): Record<string, unknown> {
    return mockSessionsCreate.mock.calls[0]![0] as Record<string, unknown>;
  }
  function asStaffOf(salonId: string) {
    vi.mocked(getOptionalSession).mockResolvedValueOnce({
      user: { id: STAFF_USER_ID, email: STAFF_EMAIL, name: "Staff 193" },
    } as never);
    vi.mocked(getSalonContext).mockResolvedValueOnce({ salonId } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbSelect
      .mockReturnValueOnce(createChainMock([]))
      .mockReturnValueOnce(createChainMock([]));
    appointmentChain = createChainMock([insertedAppointment]);
    mockDbInsert
      .mockReturnValueOnce(appointmentChain)
      .mockReturnValueOnce(createChainMock([insertedPayment]));
    mockDbUpdate.mockReturnValue(createChainMock([]));
    mockDbDelete.mockReturnValue(createChainMock([]));
    primeExpectedDeposit(50);
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripe);
    mockSessionsCreate.mockResolvedValue({
      id: "cs_test_193",
      url: "https://checkout.stripe.com/c/pay/cs_test_193",
    });
  });

  it("personel tego salonu → bookedByUserId null, bez e-maila personelu w Stripe (pole pominięte)", async () => {
    asStaffOf(SALON_UUID);
    const res = await createSession(makeRequest({ ...validBody, clientId: CLIENT_UUID }));
    expect(res.status).toBe(201);
    expect(appointmentValues().bookedByUserId).toBeNull();
    expect(appointmentValues().clientId).toBe(CLIENT_UUID);
    expect(stripeArgs()).not.toHaveProperty("customer_email");
    expect(JSON.stringify(mockSessionsCreate.mock.calls)).not.toContain(STAFF_EMAIL);
  });

  it("personel tego salonu z e-mailem gościa w formularzu → customer_email gościa, nie personelu", async () => {
    asStaffOf(SALON_UUID);
    const res = await createSession(
      makeRequest({ ...validBody, guestName: "Anna Test", guestPhone: TEST_PHONE, guestEmail: GUEST_EMAIL })
    );
    expect(res.status).toBe(201);
    expect(appointmentValues().bookedByUserId).toBeNull();
    expect(stripeArgs().customer_email).toBe(GUEST_EMAIL);
  });

  it("personel INNEGO salonu → traktowany jak klient portalu: id i e-mail z sesji", async () => {
    asStaffOf("99999999-9999-4999-8999-999999999999");
    const res = await createSession(makeRequest());
    expect(res.status).toBe(201);
    expect(appointmentValues().bookedByUserId).toBe(STAFF_USER_ID);
    expect(stripeArgs().customer_email).toBe(STAFF_EMAIL);
  });

  it("klient portalu → bookedByUserId z sesji, customer_email z sesji", async () => {
    vi.mocked(getOptionalSession).mockResolvedValueOnce({
      user: { id: PORTAL_USER_ID, email: PORTAL_EMAIL, name: "Portal 193" },
    } as never);
    const res = await createSession(makeRequest());
    expect(res.status).toBe(201);
    expect(appointmentValues().bookedByUserId).toBe(PORTAL_USER_ID);
    expect(stripeArgs().customer_email).toBe(PORTAL_EMAIL);
  });

  it("gość bez sesji → bookedByUserId null, customer_email gościa, kontekst salonu nieczytany", async () => {
    vi.mocked(getOptionalSession).mockResolvedValueOnce(null as never);
    const res = await createSession(
      makeRequest({ ...validBody, guestName: "Anna Test", guestPhone: TEST_PHONE, guestEmail: GUEST_EMAIL })
    );
    expect(res.status).toBe(201);
    expect(appointmentValues().bookedByUserId).toBeNull();
    expect(stripeArgs().customer_email).toBe(GUEST_EMAIL);
    expect(getSalonContext).not.toHaveBeenCalled();
  });
});

describe("POST /api/deposits/create-session — numer telefonu BLIK z żądania nie jest zapisywany", () => {
  const BLIK_RAW = "+48 123 456 789";
  const BLIK_DIGITS = "123456789";
  const mockSessionsCreate = vi.fn();
  const fakeStripe = {
    checkout: { sessions: { create: (...a: unknown[]) => mockSessionsCreate(...a) } },
  };

  let appointmentChain: ReturnType<typeof createChainMock>;
  let paymentChain: ReturnType<typeof createChainMock>;
  let updateChain: ReturnType<typeof createChainMock>;
  let logSpies: ReturnType<typeof vi.spyOn>[];

  /** Argumenty wszystkich zapisów do bazy (values / set) po serializacji. */
  function dbWriteArgs(): string {
    const calls = (chain: Record<string, unknown>, method: string) =>
      (chain[method] as ReturnType<typeof vi.fn>).mock.calls;
    return JSON.stringify([
      calls(appointmentChain, "values"),
      calls(paymentChain, "values"),
      calls(updateChain, "set"),
    ]);
  }

  function paymentValues(): Record<string, unknown> {
    return (paymentChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
  }

  function expectNoNumber(serialized: string) {
    expect(serialized).not.toContain(BLIK_DIGITS);
    expect(serialized).not.toContain("123 456 789");
  }

  beforeEach(async () => {
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    vi.clearAllMocks();
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbSelect
      .mockReturnValueOnce(createChainMock([]))
      .mockReturnValueOnce(createChainMock([]));
    appointmentChain = createChainMock([insertedAppointment]);
    paymentChain = createChainMock([insertedPayment]);
    updateChain = createChainMock([]);
    mockDbInsert.mockReturnValueOnce(appointmentChain).mockReturnValueOnce(paymentChain);
    mockDbUpdate.mockReturnValue(updateChain);
    mockDbDelete.mockReturnValue(createChainMock([]));
    primeExpectedDeposit(50);
    mockSessionsCreate.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    const { logger } = await import("@/lib/logger");
    logSpies = [vi.spyOn(logger, "info"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "error")];
  });

  afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
  });

  it("Stripe skonfigurowany, żądanie z numerem BLIK: ta sama odpowiedź co bez numeru, wiersz płatności z null, numer poza zapisem i sesją Stripe", async () => {
    mockIsStripeConfigured.mockReturnValue(true);
    mockGetStripe.mockReturnValue(fakeStripe);

    const withNumber = await createSession(
      makeRequest({ ...validBody, paymentMethod: "blik", blikPhoneNumber: BLIK_RAW })
    );
    const withNumberParsed = await parseResponse<{ success: boolean; data: Record<string, unknown> }>(withNumber);

    expect(withNumberParsed.status).toBe(201);
    expect(withNumberParsed.body.success).toBe(true);
    expect(paymentValues().blikPhoneNumber).toBeNull();
    expectNoNumber(dbWriteArgs());
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    expectNoNumber(JSON.stringify(mockSessionsCreate.mock.calls));
    expectNoNumber(JSON.stringify(withNumberParsed.body));
    for (const spy of logSpies) expectNoNumber(JSON.stringify(spy.mock.calls));

    // Ta sama trasa bez numeru: ten sam status i ten sam kształt odpowiedzi.
    mockDbSelect
      .mockReturnValueOnce(createChainMock([]))
      .mockReturnValueOnce(createChainMock([]));
    mockDbInsert
      .mockReturnValueOnce(createChainMock([insertedAppointment]))
      .mockReturnValueOnce(createChainMock([insertedPayment]));
    const without = await createSession(makeRequest({ ...validBody, paymentMethod: "blik" }));
    const withoutParsed = await parseResponse<{ success: boolean; data: Record<string, unknown> }>(without);
    expect(withoutParsed.status).toBe(withNumberParsed.status);
    expect(withoutParsed.body).toEqual(withNumberParsed.body);
  });

  it("tryb symulacji (Stripe nieskonfigurowany), żądanie z numerem BLIK: wiersz płatności z null, numer poza zapisem, odpowiedzią i logami", async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(null);

    const response = await createSession(
      makeRequest({ ...validBody, paymentMethod: "blik", blikPhoneNumber: BLIK_RAW })
    );
    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(response);

    expect(status).toBe(201);
    expect(body.data.simulated).toBe(true);
    expect(paymentValues().paymentMethod).toBe("blik");
    expect(paymentValues().blikPhoneNumber).toBeNull();
    expectNoNumber(dbWriteArgs());
    expectNoNumber(JSON.stringify(body));
    for (const spy of logSpies) expectNoNumber(JSON.stringify(spy.mock.calls));
  });

  it("żądanie bez numeru BLIK: wiersz płatności z null", async () => {
    mockIsStripeConfigured.mockReturnValue(false);
    mockGetStripe.mockReturnValue(null);

    const response = await createSession(makeRequest({ ...validBody, paymentMethod: "blik" }));

    expect(response.status).toBe(201);
    expect(paymentValues().blikPhoneNumber).toBeNull();
  });
});

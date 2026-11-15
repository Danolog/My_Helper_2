/**
 * Kontrakt front ↔ POST /api/deposits/create-session (P0, 400 "Validation
 * failed" na każdej rezerwacji z zadatkiem od a00d059, 2026-03-15).
 *
 * Payload NIE jest przepisany ręcznie: budujemy go tą samą funkcją, której
 * używa formularz portalu (buildDepositBody z useBookingData). Front wysyła
 * clientId: null, variantId: null (usługa bez wariantu), guestEmail: null
 * (gość bez e-maila) i telefon w formacie wpisanym przez gościa — schemat
 * z .optional() odrzucał null i telefon ze spacjami/myślnikami.
 *
 * Kody trasy (201 sukces, nie 200; 401/403 — patrz opis przy testach):
 * 201, 400, "401" (gość bez sesji = 400, nie 401), "403" (nie-personel →
 * clientId ignorowany, nie 403), 404, 409, 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, createChainMock } from "./helpers";
import { buildDepositBody, type DepositBodyInput } from "@/app/(client)/salons/[id]/book/_lib/deposit-body";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_UUID = "22222222-2222-4222-8222-222222222222";
const CLIENT_UUID = "33333333-3333-4333-8333-333333333333";
const SERVICE_UUID = "44444444-4444-4444-8444-444444444444";
const VARIANT_UUID = "55555555-5555-4555-8555-555555555555";
const APPOINTMENT_UUID = "66666666-6666-4666-8666-666666666666";
const DEPOSIT_PAYMENT_UUID = "77777777-7777-4777-8777-777777777777";

// -------------------------------------------------------
// Mocks
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

const LOGGED_IN = { user: { id: "user-1", email: "klient@test.pl", name: "Klient" } };
const mockGetOptionalSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getOptionalSession: (...a: unknown[]) => mockGetOptionalSession(...a),
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: {
    check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }),
  },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

const mockCalcDeposit = vi.fn();
vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: (...a: unknown[]) => mockCalcDeposit(...a),
}));

const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...a: unknown[]) => mockGetSalonContext(...a),
}));

const mockAssertSalonRefs = vi.fn();
vi.mock("@/lib/salon-refs", () => ({
  assertSalonRefs: (...a: unknown[]) => mockAssertSalonRefs(...a),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => null,
  isStripeConfigured: () => false,
}));

import { POST } from "@/app/api/deposits/create-session/route";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

/** Stan formularza tak, jak trzyma go useBookingData (stringi z useState). */
function formState(overrides: Partial<DepositBodyInput> = {}): DepositBodyInput {
  const startTime = new Date("2026-12-01T10:00:00.000Z");
  return {
    salonId: SALON_UUID,
    employeeId: EMPLOYEE_UUID,
    serviceId: SERVICE_UUID,
    variantId: "", // usługa bez wariantu — domyślny stan hooka
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60000),
    notes: "Rezerwacja online: Strzyzenie",
    depositAmount: 50,
    paymentMethod: "stripe", // domyślny stan hooka
    isLoggedIn: true,
    guestName: "",
    guestPhone: "",
    guestEmail: "",
    ...overrides,
  };
}

const GUEST = {
  isLoggedIn: false,
  guestName: "  Anna Nowak ",
  guestPhone: "+48 123 456 789",
  guestEmail: "", // e-mail opcjonalny → front wysyła null
};

let appointmentChain: ReturnType<typeof createChainMock>;

function primeHappyPath() {
  mockDbSelect
    .mockReturnValueOnce(createChainMock([])) // kolizje wizyt
    .mockReturnValueOnce(createChainMock([])); // blokady czasu
  appointmentChain = createChainMock([{ id: APPOINTMENT_UUID }]);
  mockDbInsert
    .mockReturnValueOnce(appointmentChain)
    .mockReturnValueOnce(createChainMock([{ id: DEPOSIT_PAYMENT_UUID }]));
  mockDbUpdate.mockReturnValue(createChainMock([]));
  mockAssertSalonRefs.mockResolvedValue(null);
  mockCalcDeposit.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
}

function post(body: unknown) {
  return POST(
    createMockRequest("http://localhost:3000/api/deposits/create-session", {
      method: "POST",
      body: body as Record<string, unknown>,
    })
  );
}

/** Wartości przekazane do INSERT wizyty. */
function insertedAppointment(): Record<string, unknown> {
  const values = appointmentChain.values as ReturnType<typeof vi.fn>;
  return values.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbSelect.mockReset();
  mockDbInsert.mockReset();
  mockGetSalonContext.mockResolvedValue(null);
  primeHappyPath();
});

// -------------------------------------------------------
// Kontrakt: dokładny payload formularza
// -------------------------------------------------------

describe("kontrakt formularza portalu → create-session", () => {
  it("zalogowany klient, usługa bez wariantu: payload formularza (clientId/variantId: null) → 201", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const body = buildDepositBody(formState());
    // Strażnik kontraktu: jeśli front przestanie wysyłać null, test i tak
    // ma sprawdzać tolerancję serwera (stare fronty z pamięci PWA).
    expect(body.clientId).toBeNull();
    expect(body.variantId).toBeNull();

    const res = await post(body);
    const { status, body: json } = await parseResponse<{ success: boolean; data: Record<string, unknown> }>(res);

    expect(status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.appointmentId).toBe(APPOINTMENT_UUID);
    expect(insertedAppointment()).toMatchObject({
      clientId: null,
      variantId: null,
      guestName: null,
      guestPhone: null,
      guestEmail: null,
    });
    expect(mockCalcDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: null, guestEmail: null })
    );
  });

  it("zalogowany klient z wariantem → 201, variantId przekazany dalej", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post(buildDepositBody(formState({ variantId: VARIANT_UUID })));

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ variantId: VARIANT_UUID });
    expect(mockCalcDeposit).toHaveBeenCalledWith(expect.objectContaining({ variantId: VARIANT_UUID }));
  });

  it("gość bez e-maila, telefon ze spacjami: payload formularza → 201, zapis znormalizowany", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const body = buildDepositBody(formState(GUEST));
    expect(body).toMatchObject({ guestEmail: null, guestPhone: "+48 123 456 789" });

    const res = await post(body);

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({
      clientId: null,
      guestName: "Anna Nowak",
      guestPhone: "+48123456789",
      guestEmail: null,
    });
  });

  it("gość z e-mailem → 201, e-mail trafia do wyliczenia kwoty i na wizytę", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const res = await post(buildDepositBody(formState({ ...GUEST, guestEmail: " anna@test.pl " })));

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ guestEmail: "anna@test.pl" });
    expect(mockCalcDeposit).toHaveBeenCalledWith(expect.objectContaining({ guestEmail: "anna@test.pl" }));
  });
});

// -------------------------------------------------------
// Telefon: normalizacja przed regexem
// -------------------------------------------------------

describe("telefon gościa", () => {
  beforeEach(() => mockGetOptionalSession.mockResolvedValue(null));

  it.each([
    ["+48 123 456 789", "+48123456789"],
    ["123-456-789", "123456789"],
    ["(12) 345-67-89", "123456789"],
    ["123456789", "123456789"],
  ])("%s → 201, zapis %s", async (input, stored) => {
    const res = await post(buildDepositBody(formState({ ...GUEST, guestPhone: input })));

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ guestPhone: stored });
  });

  it.each(["12345", "+49 123 456 789", "123 456 78a", "1234567890"])(
    "%s → 400, nic nie zapisane",
    async (input) => {
      const res = await post(buildDepositBody(formState({ ...GUEST, guestPhone: input })));
      const { status, body } = await parseResponse<{ success: boolean; details?: Record<string, string> }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.details?.guestPhone).toBeDefined();
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockCalcDeposit).not.toHaveBeenCalled();
    }
  );
});

// -------------------------------------------------------
// Tolerancja serwera na dowolnego klienta (null / "" / brak pola)
// -------------------------------------------------------

describe("tolerancja null i pustych pól", () => {
  it("wszystkie pola opcjonalne jako null → 201 (zalogowany)", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post({
      ...buildDepositBody(formState()),
      variantId: null,
      clientId: null,
      notes: null,
      paymentMethod: null,
      blikPhoneNumber: null,
      guestName: null,
      guestPhone: null,
      guestEmail: null,
    });

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ notes: null, variantId: null });
  });

  it("puste stringi zamiast null → 201 (gość, e-mail \"\")", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const res = await post({ ...buildDepositBody(formState(GUEST)), guestEmail: "", variantId: "" });

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ guestEmail: null, variantId: null });
  });

  it("null w polu wymaganym (employeeId) nadal → 400", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post({ ...buildDepositBody(formState()), employeeId: null });
    const { status, body } = await parseResponse<{ details?: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.details?.employeeId).toBeDefined();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("niepoprawny e-mail gościa nadal → 400", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const res = await post(buildDepositBody(formState({ ...GUEST, guestEmail: "nie-email" })));
    const { status, body } = await parseResponse<{ details?: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.details?.guestEmail).toBeDefined();
  });
});

// -------------------------------------------------------
// Pozostałe kody trasy (logika bez zmian)
// -------------------------------------------------------

describe("kody odpowiedzi trasy", () => {
  it("400: serviceId null (zadatek bez usługi)", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post({ ...buildDepositBody(formState()), serviceId: null });

    expect(res.status).toBe(400);
    expect(mockCalcDeposit).not.toHaveBeenCalled();
  });

  it("400: kwota z frontu różna od serwerowej (kwotę liczy serwer)", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post(buildDepositBody(formState({ depositAmount: 1 })));

    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("201: kwota jako string (\"50\") jest parsowana i porównywana z serwerową", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post({ ...buildDepositBody(formState()), depositAmount: "50" });

    expect(res.status).toBe(201);
  });

  // "401": trasa jest publiczna (rezerwacja gościa) — brak sesji to nie 401,
  // tylko obowiązek podania imienia i telefonu (400).
  it("brak sesji i brak danych gościa → 400, nie 401", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const res = await post(buildDepositBody(formState({ isLoggedIn: false })));

    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // "403": nie-personel nie dostaje 403 za clientId — pole jest ignorowane
  // (P1 Ryana, wzorzec z #39); obce refy salonu → 400 z assertSalonRefs.
  it("klient portalu z cudzym clientId → clientId ignorowany (bez 403), 201", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    const res = await post({ ...buildDepositBody(formState()), clientId: CLIENT_UUID });

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ clientId: null });
  });

  it("personel tego salonu z clientId → clientId zachowany", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    mockGetSalonContext.mockResolvedValue({ salonId: SALON_UUID });
    const res = await post({ ...buildDepositBody(formState()), clientId: CLIENT_UUID });

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ clientId: CLIENT_UUID });
  });

  it("404: usługa nie istnieje (wyliczenie serwerowe)", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    mockCalcDeposit.mockResolvedValue({ ok: false, error: "service_not_found" });
    const res = await post(buildDepositBody(formState()));

    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("404: wariant nie istnieje", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    mockCalcDeposit.mockResolvedValue({ ok: false, error: "variant_not_found" });
    const res = await post(buildDepositBody(formState({ variantId: VARIANT_UUID })));
    const { status, body } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(404);
    expect(body.error).toBe("Variant not found");
  });

  it("500: INSERT wizyty nic nie zwrócił", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValueOnce(createChainMock([]));
    const res = await post(buildDepositBody(formState()));

    expect(res.status).toBe(500);
  });

  it("500: wyjątek bazy w trakcie sprawdzania kolizji", async () => {
    mockGetOptionalSession.mockResolvedValue(LOGGED_IN);
    mockDbSelect.mockReset();
    mockDbSelect.mockImplementation(() => {
      throw new Error("db down");
    });
    const res = await post(buildDepositBody(formState()));
    const { status, body } = await parseResponse<{ success: boolean }>(res);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

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
 * clientId ignorowany, nie 403), 404, 409 (kolizja wizyty i blokada czasu),
 * 500. Telefon zapisywany w E.164 (#64 pkt 4, audyt bezpieczeństwa N1).
 */
import { DrizzleQueryError } from "drizzle-orm";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  // #69: symulacja bez klucza Stripe jest opt-in (vitest: NODE_ENV=test).
  vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
  vi.clearAllMocks();
  mockDbSelect.mockReset();
  mockDbInsert.mockReset();
  mockGetSalonContext.mockResolvedValue(null);
  primeHappyPath();
});

// -------------------------------------------------------
// Kontrakt: dokładny payload formularza
// -------------------------------------------------------

// #69: flaga symulacji nie przecieka między testami.
afterEach(() => {
  vi.unstubAllEnvs();
});

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
    ["123-456-789", "+48123456789"],
    ["(12) 345-67-89", "+48123456789"],
    ["123456789", "+48123456789"],
    ["+48123456789", "+48123456789"],
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
  // (P1 z audytu bezpieczeństwa, wzorzec z #39); obce refy salonu → 400 z assertSalonRefs.
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

// -------------------------------------------------------
// fix/deposit-hardening: kolizje, trim, limity, daty, logi
// -------------------------------------------------------

describe("409: obie ścieżki kolizji (recenzja, #65)", () => {
  beforeEach(() => mockGetOptionalSession.mockResolvedValue(LOGGED_IN));

  it("409: termin zajęty przez inną wizytę, nic nie zapisane", async () => {
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValueOnce(createChainMock([{ id: "inna-wizyta" }]));
    const res = await post(buildDepositBody(formState()));
    const { status, body } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(409);
    expect(body.error).toMatch(/zajety/);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("409: pracownik ma blokadę czasu (urlop/przerwa), nic nie zapisane", async () => {
    mockDbSelect.mockReset();
    mockDbSelect
      .mockReturnValueOnce(createChainMock([])) // brak kolizji wizyt
      .mockReturnValueOnce(createChainMock([{ id: "blokada" }])); // blokada czasu
    const res = await post(buildDepositBody(formState()));
    const { status, body } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(409);
    expect(body.error).toMatch(/nie jest dostepny/);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

describe("pola gościa: trim, limity, komunikaty", () => {
  beforeEach(() => mockGetOptionalSession.mockResolvedValue(null));

  // Builder frontu przycina sam — ten test omija go i wysyła surowe body,
  // więc czerwienieje, gdy schemat przestanie przycinać guestName.
  it("nieprzycięte imię z surowego body → zapis przycięty", async () => {
    const raw = { ...buildDepositBody(formState(GUEST)), guestName: "   Anna Nowak   " };
    const res = await post(raw);

    expect(res.status).toBe(201);
    expect(insertedAppointment()).toMatchObject({ guestName: "Anna Nowak" });
  });

  it.each(["A", "  A  "])("jednoznakowe imię %j → 400 z dedykowanym komunikatem w `error`", async (name) => {
    const res = await post({ ...buildDepositBody(formState(GUEST)), guestName: name });
    const { status, body } = await parseResponse<{ error: string; code: string; details: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.error).toBe("Imię i nazwisko musi mieć min. 2 znaki (jedna litera to za mało)");
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details.guestName).toBe(body.error);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["guestName", "A".repeat(201)],
    ["guestEmail", `${"a".repeat(250)}@x.pl`],
    ["notes", "x".repeat(1001)],
  ])("%s ponad limit → 400, nic nie zapisane", async (field, value) => {
    const res = await post({ ...buildDepositBody(formState(GUEST)), [field]: value });
    const { status, body } = await parseResponse<{ details: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.details[field]).toBeDefined();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["guestName", "A".repeat(200)],
    ["notes", "x".repeat(1000)],
  ])("%s dokładnie na limicie → 201", async (field, value) => {
    const res = await post({ ...buildDepositBody(formState(GUEST)), [field]: value });
    expect(res.status).toBe(201);
  });
});

describe("startTime/endTime: format i kolejność", () => {
  beforeEach(() => mockGetOptionalSession.mockResolvedValue(LOGGED_IN));

  it.each([
    ["startTime", "jutro o 10"],
    ["endTime", "2026-13-45T99:00"],
    ["startTime", ""],
    // Follow-up #71: bez strefy → 400 przed wyceną (Date.parse czytałby czas serwera).
    ["startTime", "2026-12-01T10:00:00"],
    ["endTime", "2026-12-01T11:00:00.000"],
  ])("%s = %j → 400", async (field, value) => {
    const res = await post({ ...buildDepositBody(formState()), [field]: value });
    const { status, body } = await parseResponse<{ details: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.details[field]).toBeDefined();
    expect(mockCalcDeposit).not.toHaveBeenCalled();
  });

  it("endTime przed startTime → 400 na endTime", async () => {
    const start = new Date("2026-12-01T10:00:00.000Z");
    const res = await post(
      buildDepositBody(formState({ startTime: start, endTime: new Date(start.getTime() - 60000) }))
    );
    const { status, body } = await parseResponse<{ details: Record<string, string> }>(res);

    expect(status).toBe(400);
    expect(body.details.endTime).toMatch(/później/);
  });
});

describe("N3: log ogólnego catch bez danych gościa", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("DrizzleQueryError z parametrami → 500, log bez imienia, telefonu i e-maila", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockDbInsert.mockReset();
    mockDbInsert.mockImplementationOnce(() => {
      throw new DrizzleQueryError(
        'insert into "appointments" ("guest_name", "guest_phone", "guest_email") values ($1, $2, $3)',
        ["Anna Nowak", "+48123456789", "anna@test.pl"],
        Object.assign(new Error("duplicate key"), { code: "23505", detail: "Key (guest_email)=(anna@test.pl)" })
      );
    });

    const res = await post(
      buildDepositBody(formState({ ...GUEST, guestEmail: "anna@test.pl", guestPhone: "+48 123 456 789" }))
    );
    expect(res.status).toBe(500);

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("Deposit session creation failed");
    expect(logged).toContain("23505"); // kod błędu zostaje do diagnozy
    expect(logged).not.toContain("Anna");
    expect(logged).not.toContain("123456789");
    expect(logged).not.toContain("anna@test.pl");
  });
});

// -------------------------------------------------------
// #67: jedna reguła zadatku (depositDecision) — trzy gałęzie
// -------------------------------------------------------

describe("#67: depositDecision w create-session", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("deposit (required, kwota > 0) → 201, kwota z serwera", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(201);
  });

  it("none: required z kwotą 0 → 400 DEPOSIT_NOT_APPLICABLE + warn bez danych osobowych, nic nie zapisane", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: true, required: true, amount: 0, serviceName: "Strzyzenie" });

    const res = await post(buildDepositBody(formState({ ...GUEST, guestEmail: "anna@test.pl" }) /* front z nieaktualną kwotą 50 */));
    const { status, body: json } = await parseResponse<{ code: string }>(res);

    expect(status).toBe(400);
    expect(json.code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(mockDbInsert).not.toHaveBeenCalled();
    const warned = JSON.stringify(warnSpy.mock.calls);
    expect(warned).toContain("amount is <= 0");
    expect(warned).not.toContain("Anna");
    expect(warned).not.toContain("123456789");
    expect(warned).not.toContain("anna@test.pl");
  });

  it("none: wymóg niezgłoszony → 400 DEPOSIT_NOT_APPLICABLE (portal wraca do zwykłej rezerwacji)", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "Strzyzenie" });
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(400);
    expect(((await parseResponse<{ code: string }>(res)).body).code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("error: kwota NaN → 503, nic nie zapisane (bez cichego 'none')", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: true, required: true, amount: Number.NaN, serviceName: "Strzyzenie" });
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("error: wyjątek wyliczenia → 503 (nie ogólne 500), nic nie zapisane", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockRejectedValue(new Error("db down"));
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(503);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// #69: usunięta / wyłączona usługa z nieaktualnej strony portalu
// -------------------------------------------------------

describe("#69: usługa usunięta lub wyłączona", () => {
  it("usługa wyłączona albo usunięta (wyliczenie: service_not_found) → 404, nic nie zapisane", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: false, error: "service_not_found" });
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("wariant usunięty → 404, nic nie zapisane", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: false, error: "variant_not_found" });
    const res = await post(buildDepositBody(formState({ ...GUEST, variantId: VARIANT_UUID })));
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("usługa spoza salonu / usunięta (salon-refs) → 400, bez wyliczenia i zapisu", async () => {
    mockGetOptionalSession.mockResolvedValue(null);
    const { NextResponse } = await import("next/server");
    mockAssertSalonRefs.mockResolvedValue(
      NextResponse.json({ success: false, error: "Nieprawidlowe dane dla tego salonu" }, { status: 400 })
    );
    const res = await post(buildDepositBody(formState(GUEST)));
    expect(res.status).toBe(400);
    expect(mockCalcDeposit).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// #69 (recenzja): symulacja płatności bez klucza Stripe jest opt-in.
// Środowisko ustawiane jawnie w każdym teście; globalny beforeEach włącza
// flagę, więc tu najpierw ją czyścimy. VERCEL_ENV nie ma już znaczenia.
// -------------------------------------------------------

describe("bez klucza Stripe: symulacja tylko po jawnym opt-in", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("K_SERVICE", "");
    mockGetOptionalSession.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  async function expectRefused() {
    const res = await post(buildDepositBody(formState(GUEST)));
    const { status, body: json } = await parseResponse<{ code: string }>(res);
    expect(status).toBe(503);
    expect(json.code).toBe("STRIPE_UNAVAILABLE");
    expect(mockCalcDeposit).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  }

  async function expectSimulated() {
    const res = await post(buildDepositBody(formState(GUEST)));
    const { status, body: json } = await parseResponse<{ data: { simulated: boolean } }>(res);
    expect(status).toBe(201);
    expect(json.data.simulated).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
  }

  it("NODE_ENV=development, bez flagi → symulacja (201, simulated: true)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expectSimulated();
  });

  it("ALLOW_PAYMENT_SIMULATION=1 poza Vercelem (serwer E2E w CI: NODE_ENV=production) → symulacja", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    await expectSimulated();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("ALLOW_PAYMENT_SIMULATION");
  });

  it("NODE_ENV=production bez flagi → 503 STRIPE_UNAVAILABLE, nic nie zapisane", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expectRefused();
  });

  it("NODE_ENV=test bez flagi → 503", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await expectRefused();
  });

  it.each(["true", "yes", "0", " 1"])("ALLOW_PAYMENT_SIMULATION=%j (nie dokładnie \"1\") → 503", async (flag) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", flag);
    await expectRefused();
  });

  it("druga bramka: VERCEL=1 + ALLOW_PAYMENT_SIMULATION=1 → flaga zignorowana, 503 + błąd w logu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    await expectRefused();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("ALLOW_PAYMENT_SIMULATION=1 ignored on Vercel");
  });

  it("#84: VERCEL=1 + NODE_ENV=development, bez flagi → 503 (bramka Vercela przed development), bez błędu o fladze", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    await expectRefused();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("ALLOW_PAYMENT_SIMULATION");
  });

  it("#84: VERCEL=1 + NODE_ENV=development + flaga → 503 i błąd o zignorowanej fladze", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    await expectRefused();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("ALLOW_PAYMENT_SIMULATION=1 ignored on Vercel");
  });

  it("#106: Cloud Run (K_SERVICE) + NODE_ENV=development, bez flagi → 503 (bramka hostingu przed development)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("K_SERVICE", "myhelper");
    await expectRefused();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("ALLOW_PAYMENT_SIMULATION");
  });

  it("#106: Cloud Run (K_SERVICE) + ALLOW_PAYMENT_SIMULATION=1 → flaga zignorowana, 503 + błąd w logu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("K_SERVICE", "myhelper");
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    await expectRefused();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("ALLOW_PAYMENT_SIMULATION=1 ignored on Cloud Run");
  });

  it.each(["", "   "])("#106: K_SERVICE=%j (pusty) nie blokuje: NODE_ENV=development → symulacja", async (kService) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("K_SERVICE", kService);
    await expectSimulated();
  });

  it.each(["0", "", "true"])("VERCEL=%j (nie \"1\") nie blokuje: NODE_ENV=development → symulacja", async (vercel) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", vercel);
    await expectSimulated();
  });

  it.each(["production", "preview", "development"])(
    "VERCEL_ENV=%s nie decyduje: NODE_ENV=production bez flagi → 503",
    async (vercelEnv) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      await expectRefused();
    }
  );
});

describe("#67: kod DEPOSIT_NOT_APPLICABLE wspólny dla serwera i portalu", () => {
  it("front (deposit-body) i serwer (deposit-guard) używają tej samej wartości", async () => {
    const server = await import("@/lib/deposit-guard");
    const front = await import("@/app/(client)/salons/[id]/book/_lib/deposit-body");
    expect(front.DEPOSIT_NOT_APPLICABLE_CODE).toBe(server.DEPOSIT_NOT_APPLICABLE_CODE);
    expect(front.isDepositNotApplicable(400, { code: server.DEPOSIT_NOT_APPLICABLE_CODE })).toBe(true);
    expect(front.isDepositNotApplicable(409, { code: server.DEPOSIT_NOT_APPLICABLE_CODE })).toBe(false);
    expect(front.isDepositNotApplicable(400, { code: "VALIDATION_FAILED" })).toBe(false);
    expect(front.isDepositNotApplicable(400, null)).toBe(false);
  });
});

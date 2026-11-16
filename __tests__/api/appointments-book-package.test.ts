/**
 * POST /api/appointments/book-package — P1 (Ryan): clientId i employeeId
 * z body muszą należeć do salonu z sesji (assertSalonRefs).
 *
 * UWAGA: bookPackageSchema (api-validation.ts) nie odpowiada polom, których
 * używa trasa (wymaga salonId/serviceId/dates, a trasa czyta
 * promotionId/startTime; UI wysyła clientId: null przy braku klienta).
 * Body w testach spełnia OBA kształty — tak samo musiałby zrobić atakujący.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as bookPackage } from "@/app/api/appointments/book-package/route";
import { createMockRequest, parseResponse, TEST_IDS } from "./helpers";
import { sqlMatches } from "./sql-predicate";

/**
 * Moduł `complexPromotions` jest zamrożony (B2) i trasa odpowiada 404 zanim
 * cokolwiek sprawdzi. Testy logiki poniżej omijają tę bramkę
 * (`guardState.bypass`), żeby zachowanie było pilnowane także na wypadek
 * odmrożenia; test „zamrożona” sprawdza bramkę prawdziwą.
 */
const { guardState } = vi.hoisted(() => ({ guardState: { bypass: true } }));
vi.mock("@/lib/server/frozen-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/frozen-guard")>();
  return {
    frozenModuleResponse: (module: Parameters<typeof real.frozenModuleResponse>[0]) =>
      guardState.bypass ? null : real.frozenModuleResponse(module),
  };
});

const { mockAssertSalonRefs, mockFindOne, mockListOwned, mockInsertValues, txQueue } = vi.hoisted(() => ({
  mockAssertSalonRefs: vi.fn(async (..._args: unknown[]): Promise<Response | null> => null),
  mockFindOne: vi.fn(),
  mockListOwned: vi.fn(),
  mockInsertValues: vi.fn(),
  /** Wyniki kolejnych tx.select(): overlap, blokady czasu. */
  txQueue: [] as unknown[][],
}));

/**
 * #165: wiersze z kolejki przechodzą przez warunek WHERE trasy (prawdziwy
 * drizzle, `sqlMatches`) — wynik kolizji zależy od znaczenia predykatu.
 */
const rowFilter = vi.hoisted(() => ({ fn: null as null | ((where: unknown, row: Record<string, unknown>) => boolean) }));

// #63: personel rozpoznawany jak w create-session (getSalonContext), a
// wymóg zadatku liczy deposit-calculation (atrapa — kontrolujemy werdykt).
const { mockGetSalonContext, mockCalcDeposit } = vi.hoisted(() => ({
  mockGetSalonContext: vi.fn(),
  mockCalcDeposit: vi.fn(),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...a: unknown[]) => mockGetSalonContext(...a),
}));
vi.mock("@/lib/deposit-calculation", () => ({
  calculateExpectedDeposit: (...a: unknown[]) => mockCalcDeposit(...a),
}));

vi.mock("@/lib/salon-refs", () => ({
  assertSalonRefs: (...args: unknown[]) => mockAssertSalonRefs(...args),
  SALON_REF_ERROR: "Nieprawidlowe dane dla tego salonu",
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "owner-user" } },
    user: { id: "owner-user" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/get-user-salon", () => ({
  // TEST_IDS z ./helpers nie jest dostępny w hoistowanej fabryce — ten sam salon.
  getUserSalonId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/server/repository", () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    let where: unknown;
    for (const m of ["from", "limit"]) c[m] = () => c;
    c.where = (w: unknown) => {
      where = w;
      return c;
    };
    c.then = (resolve: (v: unknown[]) => unknown) =>
      resolve(
        where !== undefined && rowFilter.fn
          ? rows.filter((r) => rowFilter.fn!(where, r as Record<string, unknown>))
          : rows
      );
    return c;
  };
  const tx = {
    select: () => chain(txQueue.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mockInsertValues(v);
        return { returning: async () => [{ id: `apt-${mockInsertValues.mock.calls.length}`, ...v }] };
      },
    }),
  };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      findOne: (...a: unknown[]) => mockFindOne(...a),
      listOwned: (...a: unknown[]) => mockListOwned(...a),
      raw: (fn: (t: typeof tx) => unknown) => fn(tx),
    }),
  };
});

rowFilter.fn = (where, row) => sqlMatches(where as Parameters<typeof sqlMatches>[0], row);

const SERVICE_1 = "33333333-0000-4000-8000-000000000001";
const SERVICE_2 = "33333333-0000-4000-8000-000000000002";
const PROMOTION = "44444444-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function request(extra: Record<string, unknown> = {}) {
  return createMockRequest("http://localhost:3000/api/appointments/book-package", {
    method: "POST",
    body: {
      // pola wymagane przez bookPackageSchema
      salonId: TEST_IDS.SALON_UUID,
      serviceId: SERVICE_1,
      dates: ["2026-04-01"],
      // pola czytane przez trasę
      promotionId: PROMOTION,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      clientId: TEST_IDS.CLIENT_UUID,
      startTime: "2026-04-01T10:00:00Z",
      ...extra,
    },
  });
}

describe("POST /api/appointments/book-package — zamrożona (B2)", () => {
  it("404 MODULE_DISABLED przed sesją, walidacją i bazą", async () => {
    guardState.bypass = false;
    try {
      const res = await bookPackage(request());
      const { status, body } = await parseResponse(res);
      expect(status).toBe(404);
      expect(body).toEqual({
        success: false,
        code: "MODULE_DISABLED",
        error: "Ta funkcja jest obecnie niedostępna.",
      });
      expect(mockFindOne).not.toHaveBeenCalled();
      expect(mockAssertSalonRefs).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
    } finally {
      guardState.bypass = true;
    }
  });
});

describe("POST /api/appointments/book-package — referencje z salonu (P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue.length = 0;
    txQueue.push([], []); // brak kolizji, brak blokad
    mockAssertSalonRefs.mockImplementation(async () => null);
    // domyślnie: personel tego salonu (wyjątek od zadatku)
    mockGetSalonContext.mockResolvedValue({ salonId: TEST_IDS.SALON_UUID, role: "owner" });
    mockCalcDeposit.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "A" });
    mockFindOne.mockResolvedValue({
      id: PROMOTION,
      salonId: TEST_IDS.SALON_UUID,
      name: "Pakiet",
      type: "package",
      isActive: true,
      startDate: null,
      endDate: null,
      value: "150.00",
      conditionsJson: { packageServiceIds: [SERVICE_1, SERVICE_2] },
    });
    mockListOwned.mockResolvedValue([
      { id: SERVICE_1, name: "A", basePrice: "100.00", baseDuration: 30 },
      { id: SERVICE_2, name: "B", basePrice: "80.00", baseDuration: 45 },
    ]);
  });

  it("happy path: sprawdza clientId i employeeId w salonie z sesji, tworzy wizyty", async () => {
    const res = await bookPackage(request());
    const { status } = await parseResponse(res);
    expect(status).toBe(201);
    expect(mockAssertSalonRefs).toHaveBeenCalledWith(TEST_IDS.SALON_UUID, {
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
    });
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    expect(mockInsertValues.mock.calls[0]![0]).toMatchObject({
      salonId: TEST_IDS.SALON_UUID,
      clientId: TEST_IDS.CLIENT_UUID,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
    });
  });

  it("obcy clientId lub employeeId -> 400, bez kolizji i zapisu", async () => {
    mockAssertSalonRefs.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Nieprawidlowe dane dla tego salonu" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const res = await bookPackage(request({ clientId: FOREIGN_CLIENT }));
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: "Nieprawidlowe dane dla tego salonu" });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(txQueue).toHaveLength(2); // żadne zapytanie o kolizje nie poszło
  });

  it("referencje sprawdzane przed odczytem promocji (brak sondowania cudzych danych)", async () => {
    mockAssertSalonRefs.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await bookPackage(request({ employeeId: FOREIGN_CLIENT }));
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/appointments/book-package — zadatek (#63, na wypadek odmrożenia)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue.length = 0;
    txQueue.push([], []);
    mockAssertSalonRefs.mockImplementation(async () => null);
    mockFindOne.mockResolvedValue({
      id: PROMOTION,
      salonId: TEST_IDS.SALON_UUID,
      name: "Pakiet",
      type: "package",
      isActive: true,
      startDate: null,
      endDate: null,
      value: "150.00",
      conditionsJson: { packageServiceIds: [SERVICE_1, SERVICE_2] },
    });
    mockListOwned.mockResolvedValue([
      { id: SERVICE_1, name: "A", basePrice: "100.00", baseDuration: 30 },
      { id: SERVICE_2, name: "B", basePrice: "80.00", baseDuration: 45 },
    ]);
    // druga usługa pakietu wymaga zadatku
    mockCalcDeposit.mockImplementation(async (p: { serviceId: string }) =>
      p.serviceId === SERVICE_2
        ? { ok: true, required: true, amount: 24, serviceName: "B" }
        : { ok: true, required: false, amount: 0, serviceName: "A" }
    );
  });

  it("personel TEGO salonu → wyjątek: 201, wymóg zadatku nie jest liczony", async () => {
    mockGetSalonContext.mockResolvedValue({ salonId: TEST_IDS.SALON_UUID, role: "owner" });
    const res = await bookPackage(request());
    expect(res.status).toBe(201);
    expect(mockCalcDeposit).not.toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("kontekst INNEGO salonu → bez wyjątku: 400 DEPOSIT_REQUIRED, bez kolizji i zapisu", async () => {
    mockGetSalonContext.mockResolvedValue({ salonId: "99999999-9999-4999-8999-999999999999", role: "owner" });
    const res = await bookPackage(request());
    const { status, body } = await parseResponse<{ code: string }>(res);
    expect(status).toBe(400);
    expect(body.code).toBe("DEPOSIT_REQUIRED");
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(txQueue).toHaveLength(2); // kolizje nie sprawdzane
  });

  it("brak kontekstu salonu + błąd wyliczenia → 503, nic nie zapisane", async () => {
    mockGetSalonContext.mockResolvedValue(null);
    mockCalcDeposit.mockRejectedValue(new Error("db down"));
    const res = await bookPackage(request());
    expect(res.status).toBe(503);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(txQueue).toHaveLength(2);
  });

  it("brak kontekstu salonu, żadna usługa nie wymaga zadatku → 201", async () => {
    mockGetSalonContext.mockResolvedValue(null);
    mockCalcDeposit.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "A" });
    const res = await bookPackage(request());
    expect(res.status).toBe(201);
    expect(mockCalcDeposit).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/appointments/book-package — kolizja półotwarta (#165)", () => {
  // Pakiet: 30 + 45 min od 10:00, czyli jeden przedział [10:00, 11:15).
  const appt = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    salon_id: TEST_IDS.SALON_UUID,
    employee_id: TEST_IDS.EMPLOYEE_UUID,
    status: "scheduled",
    start_time: new Date(`2026-04-01T${start}:00Z`),
    end_time: new Date(`2026-04-01T${end}:00Z`),
    ...extra,
  });
  const block = (start: string, end: string) => ({
    id: "block-165",
    employee_id: TEST_IDS.EMPLOYEE_UUID,
    start_time: new Date(`2026-04-01T${start}:00Z`),
    end_time: new Date(`2026-04-01T${end}:00Z`),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    txQueue.length = 0;
    mockAssertSalonRefs.mockImplementation(async () => null);
    mockGetSalonContext.mockResolvedValue({ salonId: TEST_IDS.SALON_UUID, role: "owner" });
    mockFindOne.mockResolvedValue({
      id: PROMOTION,
      salonId: TEST_IDS.SALON_UUID,
      name: "Pakiet",
      type: "package",
      isActive: true,
      startDate: null,
      endDate: null,
      value: "150.00",
      conditionsJson: { packageServiceIds: [SERVICE_1, SERVICE_2] },
    });
    mockListOwned.mockResolvedValue([
      { id: SERVICE_1, name: "A", basePrice: "100.00", baseDuration: 30 },
      { id: SERVICE_2, name: "B", basePrice: "80.00", baseDuration: 45 },
    ]);
  });

  it("wizyta na styku przed pakietem (09–10) → 201", async () => {
    txQueue.push([appt("09:00", "10:00")], []);
    expect((await bookPackage(request())).status).toBe(201);
  });

  it("wizyta na styku po pakiecie (11:15–12) → 201", async () => {
    txQueue.push([appt("11:15", "12:00")], []);
    expect((await bookPackage(request())).status).toBe(201);
  });

  it("wizyta nachodząca o 1 minutę na koniec pakietu → 409, bez zapisu", async () => {
    txQueue.push([appt("11:14", "12:00")], []);
    const res = await bookPackage(request());
    const { status, body } = await parseResponse(res);
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("wizyta w środku pakietu (10:30–10:45) → 409", async () => {
    txQueue.push([appt("10:30", "10:45")], []);
    expect((await bookPackage(request())).status).toBe(409);
  });

  it("anulowana wizyta w terminie pakietu nie koliduje → 201", async () => {
    txQueue.push([appt("10:00", "11:00", { status: "cancelled" })], []);
    expect((await bookPackage(request())).status).toBe(201);
  });

  it("wizyta innego salonu nie koliduje (filtr salonu) → 201", async () => {
    txQueue.push([appt("10:00", "11:00", { salon_id: "cccccccc-0000-4000-8000-000000000003" })], []);
    expect((await bookPackage(request())).status).toBe(201);
  });

  it("blokada czasu na styku po pakiecie (11:15–12) → 201", async () => {
    txQueue.push([], [block("11:15", "12:00")]);
    expect((await bookPackage(request())).status).toBe(201);
  });

  // Q8 (#168): urlop jednego pracownika nie blokuje pakietu u innego.
  it("blokada INNEGO pracownika w terminie pakietu → 201, obie wizyty zapisane", async () => {
    txQueue.push([], [{ ...block("10:00", "11:15"), employee_id: "22222222-2222-4222-8222-999999999999" }]);
    expect((await bookPackage(request())).status).toBe(201);
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
  });

  it("kontrast Q8: ta sama blokada u pracownika pakietu → 409, bez zapisu", async () => {
    txQueue.push([], [block("10:00", "11:15")]);
    expect((await bookPackage(request())).status).toBe(409);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("pakiet o zerowym łącznym czasie (baseDuration 0) → 400, bez sprawdzania kolizji i zapisu", async () => {
    mockListOwned.mockResolvedValue([
      { id: SERVICE_1, name: "A", basePrice: "100.00", baseDuration: 0 },
      { id: SERVICE_2, name: "B", basePrice: "80.00", baseDuration: 0 },
    ]);
    txQueue.push([appt("10:00", "11:00")], []);
    const { status, body } = await parseResponse(await bookPackage(request()));
    expect(status).toBe(400);
    expect(body.error).toBe("Package services must have a positive total duration");
    expect(txQueue).toHaveLength(2);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("nieprawidłowy startTime → 400, bez sprawdzania kolizji i zapisu", async () => {
    txQueue.push([], []);
    const { status } = await parseResponse(await bookPackage(request({ startTime: "nie-data" })));
    expect(status).toBe(400);
    expect(txQueue).toHaveLength(2);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("blokada czasu nachodząca o 1 minutę → 409", async () => {
    txQueue.push([], [block("11:14", "12:00")]);
    const { status, body } = await parseResponse(await bookPackage(request()));
    expect(status).toBe(409);
    expect(body.error).toBe("Employee has time block during the requested period");
  });
});

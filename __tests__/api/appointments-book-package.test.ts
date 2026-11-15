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
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
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

/**
 * /api/appointments/[id]/invoice — statusy i kształt odpowiedzi (GET, POST).
 *
 * Atrapa `db` wystawia zapytania WYŁĄCZNIE wewnątrz `db.transaction` (czyli przez
 * `forSalon(...).raw`); wywołanie `db.select/insert` poza transakcją rzuca, więc
 * każdy test pilnuje też, że trasa nie czyta surowym `db` (#193).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/appointments/[id]/invoice/route";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

const mockTxSelect = vi.fn();
const mockTxInsert = vi.fn();
const mockExecute = vi.fn();

vi.mock("@/lib/db", () => {
  const tx = {
    select: (...args: unknown[]) => mockTxSelect(...args),
    insert: (...args: unknown[]) => mockTxInsert(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
  };
  const outside = () => {
    throw new Error("surowe db poza forSalon");
  };
  return {
    db: {
      select: outside,
      insert: outside,
      update: outside,
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`),
    });
  return {
    appointments: createTable("appointments"),
    clients: createTable("clients"),
    employees: createTable("employees"),
    services: createTable("services"),
    salons: createTable("salons"),
    appointmentMaterials: createTable("appointmentMaterials"),
    products: createTable("products"),
    invoices: createTable("invoices"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  count: vi.fn(() => ({ type: "count" })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

vi.mock("@/lib/constants", () => ({ DEFAULT_VAT_RATE: 23 }));

const auth = vi.hoisted(() => ({ denied: false }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(async () =>
    auth.denied
      ? new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 })
      : { user: { id: "test-user-id" }, session: { user: { id: "test-user-id" } } }
  ),
  isAuthError: vi.fn((r: unknown) => r instanceof Response),
}));

const salon = vi.hoisted(() => ({ id: "" as string | null }));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn(async () => salon.id),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "leftJoin", "limit", "values", "returning"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

function failingChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "leftJoin", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB failure"));
  return chain;
}


const APPT = {
  id: TEST_IDS.APPOINTMENT_UUID,
  salonId: TEST_IDS.SALON_UUID,
  status: "completed",
  startTime: new Date("2026-11-20T10:00:00Z"),
  endTime: new Date("2026-11-20T11:00:00Z"),
  clientId: TEST_IDS.CLIENT_UUID,
  employeeId: TEST_IDS.EMPLOYEE_UUID,
  serviceId: TEST_IDS.SERVICE_UUID,
};

const url = `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/invoice`;
const post = (body: Record<string, unknown>) =>
  POST(createMockRequest(url, { method: "POST", body }) as never, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
const get = () => GET(createMockRequest(url) as never, createRouteParams(TEST_IDS.APPOINTMENT_UUID));

beforeEach(() => {
  mockTxSelect.mockReset();
  mockTxInsert.mockReset();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue(undefined);
  auth.denied = false;
  salon.id = TEST_IDS.SALON_UUID;
});

describe("GET /api/appointments/[id]/invoice", () => {
  it("401 bez sesji", async () => {
    auth.denied = true;
    const { status } = await parseResponse(await get());
    expect(status).toBe(401);
    expect(mockTxSelect).not.toHaveBeenCalled();
  });

  it("404 bez salonu w sesji", async () => {
    salon.id = null;
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon not found" });
  });

  it("200 hasInvoice false, gdy faktury brak (także dla wizyty innego salonu)", async () => {
    mockTxSelect.mockReturnValueOnce(chainMock([]));
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: null, hasInvoice: false });
  });

  it("200 hasInvoice true z fakturą", async () => {
    const invoice = { id: "inv-1", invoiceNumber: "PAR/2026/11/00001" };
    mockTxSelect.mockReturnValueOnce(chainMock([invoice]));
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: invoice, hasInvoice: true });
    // Kontekst RLS ustawiony przed odczytem (SET LOCAL ROLE + set_config).
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("500 przy błędzie bazy", async () => {
    mockTxSelect.mockReturnValueOnce(failingChain());
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Nie udalo sie pobrac faktury" });
  });
});

describe("POST /api/appointments/[id]/invoice", () => {
  it("401 bez sesji", async () => {
    auth.denied = true;
    const { status } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(401);
  });

  it("404 bez salonu w sesji", async () => {
    salon.id = null;
    const { status } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(404);
  });

  it("400 dla nieznanego typu dokumentu", async () => {
    const { status, body } = await parseResponse(await post({ type: "rachunek", clientName: "Jan" }));
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockTxSelect).not.toHaveBeenCalled();
  });

  it("400 dla faktury firmowej bez NIP", async () => {
    const { status, body } = await parseResponse(await post({ type: "faktura", companyName: "Firma" }));
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockTxSelect).not.toHaveBeenCalled();
  });

  it("404, gdy wizyty nie ma w salonie z sesji", async () => {
    mockTxSelect.mockReturnValueOnce(chainMock([]));
    const { status, body } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Wizyta nie zostala znaleziona" });
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("400 dla wizyty niezakończonej", async () => {
    mockTxSelect.mockReturnValueOnce(chainMock([{ ...APPT, status: "scheduled" }]));
    const { status, body } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(400);
    expect(body.error).toContain("zakonczonych");
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("200 alreadyExists, gdy faktura już jest", async () => {
    const existing = { id: "inv-1", invoiceNumber: "PAR/2026/11/00001" };
    mockTxSelect.mockReturnValueOnce(chainMock([APPT]));
    mockTxSelect.mockReturnValueOnce(chainMock([existing]));
    const { status, body } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: existing,
      message: "Faktura juz istnieje dla tej wizyty",
      alreadyExists: true,
    });
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("200: paragon z usługą i materiałami, numer kolejny, dane sprzedawcy z salonu", async () => {
    const saved = { id: "inv-2", invoiceNumber: "PAR/x/00004" };
    mockTxSelect
      .mockReturnValueOnce(chainMock([APPT])) // wizyta
      .mockReturnValueOnce(chainMock([])) // brak faktury
      .mockReturnValueOnce(chainMock([{ firstName: "Anna", lastName: "Nowak" }])) // klient
      .mockReturnValueOnce(chainMock([{ firstName: "Ewa", lastName: "Kowal" }])) // pracownik
      .mockReturnValueOnce(chainMock([{ name: "Strzyżenie", basePrice: "200.00" }])) // usługa
      .mockReturnValueOnce(chainMock([{ quantityUsed: "2", pricePerUnit: "5.00", productName: "Szampon" }])) // materiały
      .mockReturnValueOnce(chainMock([{ name: "Salon Test", address: "ul. Testowa 1", settingsJson: { fiscal: { nip: "1234567890" } } }])) // salon
      .mockReturnValueOnce(chainMock([{ count: 3 }])); // liczba faktur
    mockTxInsert.mockReturnValueOnce(chainMock([saved]));

    const { status, body } = await parseResponse<{
      data: unknown;
      invoiceData: {
        seller: { name: string; nip: string | null };
        buyer: { name: string };
        invoiceNumber: string;
        employee: string;
        items: { name: string; total: string }[];
        summary: { totalAmount: string };
      };
      message: string;
    }>(await post({ type: "paragon", clientName: "Jan Kowalski" }));

    expect(status).toBe(200);
    expect(body.data).toEqual(saved);
    expect(body.invoiceData.seller).toMatchObject({ name: "Salon Test", nip: "1234567890" });
    expect(body.invoiceData.buyer.name).toBe("Jan Kowalski");
    expect(body.invoiceData.employee).toBe("Ewa Kowal");
    expect(body.invoiceData.invoiceNumber).toMatch(/^PAR\/\d{4}\/\d{2}\/00004$/);
    expect(body.invoiceData.items.map((i) => i.name)).toEqual(["Strzyżenie", "Materialy uzyte podczas zabiegu"]);
    expect(body.invoiceData.summary.totalAmount).toBe("210.00");
    expect(body.message).toContain("zostala wygenerowana");
    // Wszystkie odczyty i zapis w kontekście salonu: 5 transakcji × 2 instrukcje SET.
    expect(mockExecute).toHaveBeenCalledTimes(10);
  });

  it("200: wizyta bez klienta, pracownika i usługi — bez tych zapytań, kwota 0", async () => {
    mockTxSelect
      .mockReturnValueOnce(chainMock([{ ...APPT, clientId: null, employeeId: null, serviceId: null }]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([])) // materiały
      .mockReturnValueOnce(chainMock([])) // salon (brak) → zapas „Salon”
      .mockReturnValueOnce(chainMock([{ count: 0 }]));
    mockTxInsert.mockReturnValueOnce(chainMock([{ id: "inv-3" }]));

    const { status, body } = await parseResponse<{
      invoiceData: { seller: { name: string }; employee: string | null; summary: { totalAmount: string }; buyer: { name: string } };
    }>(await post({ type: "paragon", clientName: "Gość" }));

    expect(status).toBe(200);
    expect(mockTxSelect).toHaveBeenCalledTimes(5);
    expect(body.invoiceData.seller.name).toBe("Salon");
    expect(body.invoiceData.employee).toBeNull();
    expect(body.invoiceData.summary.totalAmount).toBe("0.00");
  });

  it("500 przy błędzie bazy", async () => {
    mockTxSelect.mockReturnValueOnce(failingChain());
    const { status, body } = await parseResponse(await post({ type: "paragon", clientName: "Jan" }));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Nie udalo sie wygenerowac faktury" });
  });
});

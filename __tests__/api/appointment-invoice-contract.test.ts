/**
 * Kontrakt POST /api/appointments/[id]/invoice z oknem wystawienia dokumentu
 * w panelu (src/components/appointments/detail/invoice-dialog.tsx).
 *
 * Body wysyłane przez panel musi przejść walidację schematu (nie 400
 * "Validation failed"); komunikaty 400 trasy dla brakujących pól zostają.
 */
import type { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/appointments/[id]/invoice/route";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockRaw = vi.fn();

vi.mock("@/lib/server/repository", () => ({
  forSalon: vi.fn(() => ({ raw: (...args: unknown[]) => mockRaw(...args) })),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
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

vi.mock("@/lib/constants", () => ({ DEFAULT_VAT_RATE: 23 }));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));


// Kształty dokładnie jak w invoice-dialog.tsx (pola drugiego typu = null).
const panelReceipt = {
  type: "paragon",
  clientName: "Jan Testowy",
  clientAddress: null,
  companyName: null,
  companyNip: null,
  companyAddress: null,
  paymentMethod: "cash",
};

const panelInvoice = {
  type: "faktura",
  clientName: null,
  clientAddress: null,
  companyName: "Firma Testowa Sp. z o.o.",
  companyNip: "0000000000",
  companyAddress: null,
  paymentMethod: "card",
};

function post(body: unknown) {
  const req = createMockRequest(
    `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/invoice`,
    { method: "POST", body }
  );
  return POST(req as unknown as NextRequest, createRouteParams(TEST_IDS.APPOINTMENT_UUID));
}

describe("POST /api/appointments/[id]/invoice — kontrakt z panelem", () => {
  beforeEach(() => {
    mockRaw.mockReset();
    // Wizyta nie istnieje: trasa kończy na 404 zaraz po walidacji, więc 404
    // oznacza, że body przeszło schemat i własne sprawdzenia trasy.
    mockRaw.mockResolvedValue([]);
  });

  it("body paragonu z panelu nie daje 400 walidacji", async () => {
    const { status, body } = await parseResponse(await post(panelReceipt));
    expect(status).toBe(404);
    expect(body.error).not.toBe("Validation failed");
    expect(mockRaw).toHaveBeenCalled();
  });

  it("body faktury z panelu nie daje 400 walidacji", async () => {
    const { status, body } = await parseResponse(await post(panelInvoice));
    expect(status).toBe(404);
    expect(body.error).not.toBe("Validation failed");
    expect(mockRaw).toHaveBeenCalled();
  });

  it("stary kształt { buyerName, … } → 400 Validation failed, bez zapytań do bazy", async () => {
    const { status, body } = await parseResponse(
      await post({ buyerName: "Jan Testowy", paymentMethod: "cash" })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("paragon bez imienia klienta → komunikat 400 trasy", async () => {
    const { status, body } = await parseResponse(
      await post({ ...panelReceipt, clientName: "" })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Imie i nazwisko klienta jest wymagane");
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("faktura bez nazwy firmy → komunikat 400 trasy", async () => {
    const { status, body } = await parseResponse(
      await post({ ...panelInvoice, companyName: null })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Nazwa firmy jest wymagana");
  });

  it("faktura bez NIP → komunikat 400 trasy", async () => {
    const { status, body } = await parseResponse(
      await post({ ...panelInvoice, companyNip: null })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("NIP firmy jest wymagany");
  });

  it("nieznana metoda płatności → 400 Validation failed", async () => {
    const { status, body } = await parseResponse(
      await post({ ...panelReceipt, paymentMethod: "blik" })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(mockRaw).not.toHaveBeenCalled();
  });
});

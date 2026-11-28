/**
 * Trasa cen indywidualnych pracowników: GET, POST i DELETE
 * /api/services/[id]/employee-prices.
 *
 * Zmiana ceny indywidualnej zmienia prowizję pracownika, więc POST i DELETE
 * przyjmują tylko właściciela salonu (403 z kodem dla pracownika i recepcji).
 * GET czyta salon właściciela z sesji (getUserSalonId), jak dotąd.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const repo = vi.hoisted(() => ({
  findOne: vi.fn(),
  raw: vi.fn(),
  salonIds: [] as string[],
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: vi.fn((salonId: string) => {
    repo.salonIds.push(salonId);
    return { findOne: repo.findOne, raw: repo.raw };
  }),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => `${name}.${String(prop)}` });
  return {
    employeeServicePrices: createTable("employeeServicePrices"),
    employees: createTable("employees"),
    serviceVariants: createTable("serviceVariants"),
    services: createTable("services"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

const authState = vi.hoisted(() => ({ loggedIn: true }));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(async () =>
    authState.loggedIn
      ? { session: { user: { id: "user-1" } }, user: { id: "user-1" } }
      : NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
  ),
  isAuthError: vi.fn((result: unknown) => result instanceof NextResponse),
  requireCronSecret: vi.fn(),
}));

type Role = "owner" | "employee" | "receptionist";
const salonCtx = vi.hoisted(() => ({ role: "owner" as Role | null }));

vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn(async () =>
    salonCtx.role === null
      ? null
      : {
          salonId: TEST_IDS.SALON_UUID,
          role: salonCtx.role,
          employeeId: salonCtx.role === "owner" ? null : TEST_IDS.EMPLOYEE_UUID,
          userId: "user-1",
        }
  ),
}));

const ownerSalon = vi.hoisted(() => ({ id: "11111111-1111-1111-1111-111111111111" as string | null }));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn(async () => ownerSalon.id),
}));

// -------------------------------------------------------
// Route
// -------------------------------------------------------

import { GET, POST, DELETE } from "@/app/api/services/[id]/employee-prices/route";

const URL_BASE = `http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}/employee-prices`;
const OWNER_ONLY = {
  success: false,
  code: "EMPLOYEE_PRICE_OWNER_ONLY",
  error: "Ceny indywidualne pracowników może zmieniać tylko właściciel salonu.",
};

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "leftJoin", "update", "set", "insert", "values", "delete", "returning"]) {
    c[m] = vi.fn(() => c);
  }
  c.then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return c;
}

/** `raw(fn)` wykonuje `fn` na obiekcie tx, którego metody zwracają łańcuchy z kolejki. */
function rawWith(...results: unknown[][]) {
  const queue = [...results];
  const tx = {
    select: vi.fn(() => chain(queue.shift() ?? [])),
    update: vi.fn(() => chain(queue.shift() ?? [])),
    insert: vi.fn(() => chain(queue.shift() ?? [])),
    delete: vi.fn(() => chain(queue.shift() ?? [])),
  };
  repo.raw.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

function post(body: unknown) {
  return POST(createMockRequest(URL_BASE, { method: "POST", body }), createRouteParams(TEST_IDS.SERVICE_UUID));
}

function del(query = "?priceId=price-1") {
  return DELETE(createMockRequest(`${URL_BASE}${query}`, { method: "DELETE" }), createRouteParams(TEST_IDS.SERVICE_UUID));
}

function get() {
  return GET(createMockRequest(URL_BASE), createRouteParams(TEST_IDS.SERVICE_UUID));
}

const VALID_BODY = { employeeId: TEST_IDS.EMPLOYEE_UUID, customPrice: "120.50" };

beforeEach(() => {
  vi.clearAllMocks();
  repo.findOne.mockReset();
  repo.raw.mockReset();
  repo.salonIds = [];
  authState.loggedIn = true;
  salonCtx.role = "owner";
  ownerSalon.id = TEST_IDS.SALON_UUID;
});

// -------------------------------------------------------
// POST
// -------------------------------------------------------

describe("POST /api/services/[id]/employee-prices", () => {
  it("401 bez sesji, bez odczytu bazy", async () => {
    authState.loggedIn = false;
    const { status } = await parseResponse(await post(VALID_BODY));
    expect(status).toBe(401);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 konto bez salonu", async () => {
    salonCtx.role = null;
    const { status, body } = await parseResponse(await post(VALID_BODY));
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it.each(["employee", "receptionist"] as const)(
    "403 z kodem dla roli %s, bez odczytu i zapisu",
    async (role) => {
      salonCtx.role = role;
      const { status, body } = await parseResponse(await post(VALID_BODY));
      expect(status).toBe(403);
      expect(body).toEqual(OWNER_ONLY);
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.raw).not.toHaveBeenCalled();
    }
  );

  it.each(["employee", "receptionist"] as const)(
    "403 dla roli %s także przy nieprawidłowym body (rola przed walidacją)",
    async (role) => {
      salonCtx.role = role;
      const { status, body } = await parseResponse(await post({ customPrice: "NaN" }));
      expect(status).toBe(403);
      expect(body).toEqual(OWNER_ONLY);
    }
  );

  function postBrokenJson() {
    const request = new Request(URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nie json",
    });
    return POST(request, createRouteParams(TEST_IDS.SERVICE_UUID));
  }

  it("właściciel, niepoprawny JSON → 400 z kodem INVALID_JSON, bez odczytu bazy", async () => {
    const { status, body } = await parseResponse(await postBrokenJson());
    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      code: "INVALID_JSON",
      error: "Nie udało się odczytać danych formularza. Odśwież stronę i spróbuj ponownie.",
    });
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it.each(["employee", "receptionist"] as const)(
    "niepoprawny JSON od roli %s → nadal 403 (rola przed parsowaniem body)",
    async (role) => {
      salonCtx.role = role;
      const { status, body } = await parseResponse(await postBrokenJson());
      expect(status).toBe(403);
      expect(body).toEqual(OWNER_ONLY);
    }
  );

  it.each([["Infinity"], ["NaN"], ["-1"], [-0.01], ["abc"], [""], [null]])(
    "właściciel, customPrice %j → 400 bez zapisu",
    async (customPrice) => {
      const { status, body } = await parseResponse(await post({ ...VALID_BODY, customPrice }));
      expect(status).toBe(400);
      expect((body as any).details.customPrice).toEqual(expect.any(String));
      expect(repo.raw).not.toHaveBeenCalled();
    }
  );

  it("właściciel, bez employeeId → 400", async () => {
    const { status, body } = await parseResponse(await post({ customPrice: "10" }));
    expect(status).toBe(400);
    expect((body as any).details.employeeId).toEqual(expect.any(String));
  });

  it("404 usługa spoza salonu", async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const { status, body } = await parseResponse(await post(VALID_BODY));
    expect(status).toBe(404);
    expect(body.error).toBe("Service not found");
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 pracownik spoza salonu", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce(null);
    const { status, body } = await parseResponse(await post(VALID_BODY));
    expect(status).toBe(404);
    expect(body.error).toBe("Employee not found");
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("201 właściciel tworzy cenę: zapis liczby ze schematu, salon z sesji", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    const created = { id: "price-1", customPrice: "120.50" };
    const tx = rawWith([], [created]);

    const { status, body } = await parseResponse(await post({ ...VALID_BODY, customPrice: " 120.50 " }));

    expect(status).toBe(201);
    expect(body).toEqual({ success: true, data: created, updated: false });
    const insertChain = tx.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> };
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: TEST_IDS.EMPLOYEE_UUID, customPrice: "120.5", variantId: null })
    );
    expect(repo.salonIds.every((id) => id === TEST_IDS.SALON_UUID)).toBe(true);
  });

  it("200 właściciel aktualizuje istniejącą cenę", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    const updated = { id: "price-1", customPrice: "90.00" };
    rawWith([{ id: "price-1", variantId: null }], [updated]);

    const { status, body } = await parseResponse(await post({ ...VALID_BODY, customPrice: 90 }));

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: updated, updated: true });
  });

  it("500 przy błędzie bazy", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    repo.raw.mockRejectedValueOnce(new Error("db down"));
    const { status, body } = await parseResponse(await post(VALID_BODY));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to save employee price" });
  });
});

// -------------------------------------------------------
// DELETE
// -------------------------------------------------------

describe("DELETE /api/services/[id]/employee-prices", () => {
  it("401 bez sesji", async () => {
    authState.loggedIn = false;
    const { status } = await parseResponse(await del());
    expect(status).toBe(401);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 konto bez salonu", async () => {
    salonCtx.role = null;
    const { status } = await parseResponse(await del());
    expect(status).toBe(404);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it.each(["employee", "receptionist"] as const)("403 z kodem dla roli %s, bez usunięcia", async (role) => {
    salonCtx.role = role;
    const { status, body } = await parseResponse(await del());
    expect(status).toBe(403);
    expect(body).toEqual(OWNER_ONLY);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("400 bez priceId", async () => {
    const { status } = await parseResponse(await del(""));
    expect(status).toBe(400);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 usługa spoza salonu", async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const { status, body } = await parseResponse(await del());
    expect(status).toBe(404);
    expect(body.error).toBe("Service not found");
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 cena nie istnieje albo należy do innej usługi", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    rawWith([]);
    const { status, body } = await parseResponse(await del());
    expect(status).toBe(404);
    expect(body.error).toBe("Employee price not found");
  });

  it("200 właściciel usuwa cenę", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    const deleted = { id: "price-1" };
    rawWith([deleted]);
    const { status, body } = await parseResponse(await del());
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: deleted });
    expect(repo.salonIds.every((id) => id === TEST_IDS.SALON_UUID)).toBe(true);
  });

  it("500 przy błędzie bazy", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    repo.raw.mockRejectedValueOnce(new Error("db down"));
    const { status, body } = await parseResponse(await del());
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to delete employee price" });
  });
});

// -------------------------------------------------------
// GET (bez zmian: salon właściciela z sesji)
// -------------------------------------------------------

describe("GET /api/services/[id]/employee-prices", () => {
  it("401 bez sesji", async () => {
    authState.loggedIn = false;
    const { status } = await parseResponse(await get());
    expect(status).toBe(401);
  });

  it("404 konto bez własnego salonu (pracownik i recepcja nie mają salonu właściciela)", async () => {
    ownerSalon.id = null;
    const { status } = await parseResponse(await get());
    expect(status).toBe(404);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 usługa spoza salonu", async () => {
    repo.findOne.mockResolvedValueOnce(null);
    const { status } = await parseResponse(await get());
    expect(status).toBe(404);
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("200 właściciel: lista cen z pracownikiem i wariantem", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    rawWith([{ price: { id: "price-1", customPrice: "80.00" }, employee: { id: "e1" }, variant: null }]);
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [{ id: "price-1", customPrice: "80.00", employee: { id: "e1" }, variant: null }],
      count: 1,
    });
  });

  it("500 przy błędzie bazy", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    repo.raw.mockRejectedValueOnce(new Error("db down"));
    const { status } = await parseResponse(await get());
    expect(status).toBe(500);
  });
});

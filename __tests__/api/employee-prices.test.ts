/**
 * Trasa cen indywidualnych pracowników: GET, POST i DELETE
 * /api/services/[id]/employee-prices.
 *
 * Cena indywidualna zmienia prowizję pracownika, więc GET, POST i DELETE
 * przyjmują tylko właściciela salonu (403 z kodem dla pracownika, recepcji
 * i pracownika z grantem czasowym). Identyfikatory ceny i wariantu przechodzą
 * walidację przed bazą; wariant musi należeć do usługi z adresu.
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
// `grant`: konto ma aktywny grant czasowy w salonie z sesji — hasFeatureAccess
// i requireSalonStaff wpuściłyby je do funkcji, trasa cen nie może.
const salonCtx = vi.hoisted(() => ({ role: "owner" as Role | null, grant: false }));

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
  hasFeatureAccess: vi.fn(async (ctx: { role: Role }) => ctx.role === "owner" || salonCtx.grant),
}));

vi.mock("@/lib/temporary-access", () => ({
  hasTemporaryAccess: vi.fn(async () => salonCtx.grant),
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
const OWNER_ONLY_READ = {
  success: false,
  code: "EMPLOYEE_PRICE_OWNER_ONLY",
  error: "Ceny indywidualne pracowników może przeglądać tylko właściciel salonu.",
};
const PRICE_UUID = "77777777-7777-7777-7777-777777777777";
const VARIANT_UUID = "88888888-8888-8888-8888-888888888888";

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "leftJoin", "update", "set", "insert", "values", "delete", "returning", "limit"]) {
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

function del(query = `?priceId=${PRICE_UUID}`) {
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
  salonCtx.grant = false;
});

// -------------------------------------------------------
// Grant czasowy nie zastępuje roli właściciela
// -------------------------------------------------------

describe("grant czasowy → 403 w GET, POST i DELETE", () => {
  it.each(["employee", "receptionist"] as const)("rola %s z aktywnym grantem", async (role) => {
    salonCtx.role = role;
    salonCtx.grant = true;

    const g = await parseResponse(await get());
    const p = await parseResponse(await post(VALID_BODY));
    const d = await parseResponse(await del());

    expect([g.status, p.status, d.status]).toEqual([403, 403, 403]);
    expect(g.body).toEqual(OWNER_ONLY_READ);
    expect(p.body).toEqual(OWNER_ONLY);
    expect(d.body).toEqual(OWNER_ONLY);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });
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
    const tx = rawWith([{ id: "price-1", variantId: null }], [updated]);

    const { status, body } = await parseResponse(await post({ ...VALID_BODY, customPrice: " 90.00 " }));

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: updated, updated: true });
    // Gałąź aktualizacji zapisuje tylko cenę, jako liczbę ze schematu.
    const updateChain = tx.update.mock.results[0]!.value as { set: ReturnType<typeof vi.fn> };
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith({ customPrice: "90" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([["abc"], ["price-1"], [`${VARIANT_UUID}x`], ["' OR 1=1 --"]])(
    "właściciel, variantId %j → 400 INVALID_VARIANT_ID, bez odczytu bazy",
    async (variantId) => {
      const { status, body } = await parseResponse(await post({ ...VALID_BODY, variantId }));
      expect(status).toBe(400);
      expect(body).toEqual({
        success: false,
        code: "INVALID_VARIANT_ID",
        error: "Nieprawidłowy identyfikator wariantu usługi.",
      });
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.raw).not.toHaveBeenCalled();
    }
  );

  it("pracownik z niepoprawnym variantId → 403 (rola przed walidacją identyfikatora)", async () => {
    salonCtx.role = "employee";
    const { status, body } = await parseResponse(await post({ ...VALID_BODY, variantId: "abc" }));
    expect(status).toBe(403);
    expect(body).toEqual(OWNER_ONLY);
  });

  it("wariant innej usługi albo innego salonu → 404 SERVICE_VARIANT_NOT_FOUND, bez zapisu", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    const tx = rawWith([]);

    const { status, body } = await parseResponse(await post({ ...VALID_BODY, variantId: VARIANT_UUID }));

    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      code: "SERVICE_VARIANT_NOT_FOUND",
      error: "Nie znaleziono wariantu tej usługi.",
    });
    // Wariant szukany po id I usłudze z adresu.
    const selectChain = tx.select.mock.results[0]!.value as { where: ReturnType<typeof vi.fn> };
    expect(selectChain.where).toHaveBeenCalledWith({
      type: "and",
      args: [
        { type: "eq", args: ["serviceVariants.id", VARIANT_UUID] },
        { type: "eq", args: ["serviceVariants.serviceId", TEST_IDS.SERVICE_UUID] },
      ],
    });
    expect(repo.raw).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("wariant tej usługi → 201, zapis z variantId", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    const created = { id: PRICE_UUID, variantId: VARIANT_UUID, customPrice: "70.00" };
    const tx = rawWith([{ id: VARIANT_UUID }], [], [created]);

    const { status, body } = await parseResponse(await post({ ...VALID_BODY, variantId: VARIANT_UUID, customPrice: "70" }));

    expect(status).toBe(201);
    expect(body).toEqual({ success: true, data: created, updated: false });
    const insertChain = tx.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> };
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: VARIANT_UUID, serviceId: TEST_IDS.SERVICE_UUID, customPrice: "70" })
    );
    expect(repo.salonIds.every((id) => id === TEST_IDS.SALON_UUID)).toBe(true);
  });

  it("variantId wielkimi literami → przechodzi walidację identyfikatora", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    rawWith([]);
    const upper = "ABCDEF01-2345-6789-ABCD-EF0123456789";
    const { status, body } = await parseResponse(await post({ ...VALID_BODY, variantId: upper }));
    expect(status).toBe(404);
    expect(body.code).toBe("SERVICE_VARIANT_NOT_FOUND");
  });

  it.each([[""], [null]])("variantId %j → cena bez wariantu, bez szukania wariantu", async (variantId) => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID }).mockResolvedValueOnce({ id: TEST_IDS.EMPLOYEE_UUID });
    const created = { id: PRICE_UUID, variantId: null, customPrice: "10.00" };
    const tx = rawWith([], [created]);

    const { status } = await parseResponse(await post({ ...VALID_BODY, variantId, customPrice: "10" }));

    expect(status).toBe(201);
    expect(repo.raw).toHaveBeenCalledTimes(1);
    const insertChain = tx.insert.mock.results[0]!.value as { values: ReturnType<typeof vi.fn> };
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ variantId: null }));
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

  it.each([["price-1"], ["123"], [`${PRICE_UUID}0`], ["%27%20OR%201%3D1"]])(
    "priceId %s → 400 INVALID_PRICE_ID, bez odczytu bazy",
    async (priceId) => {
      const { status, body } = await parseResponse(await del(`?priceId=${priceId}`));
      expect(status).toBe(400);
      expect(body).toEqual({
        success: false,
        code: "INVALID_PRICE_ID",
        error: "Nieprawidłowy identyfikator ceny.",
      });
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.raw).not.toHaveBeenCalled();
    }
  );

  it("pracownik z niepoprawnym priceId → 403 (rola przed walidacją identyfikatora)", async () => {
    salonCtx.role = "employee";
    const { status, body } = await parseResponse(await del("?priceId=price-1"));
    expect(status).toBe(403);
    expect(body).toEqual(OWNER_ONLY);
  });

  it("usunięcie po id ceny i usłudze z adresu", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    const tx = rawWith([{ id: PRICE_UUID }]);
    await del();
    const deleteChain = tx.delete.mock.results[0]!.value as { where: ReturnType<typeof vi.fn> };
    expect(deleteChain.where).toHaveBeenCalledWith({
      type: "and",
      args: [
        { type: "eq", args: ["employeeServicePrices.id", PRICE_UUID] },
        { type: "eq", args: ["employeeServicePrices.serviceId", TEST_IDS.SERVICE_UUID] },
      ],
    });
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
    const deleted = { id: PRICE_UUID };
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
// GET (tylko właściciel)
// -------------------------------------------------------

describe("GET /api/services/[id]/employee-prices", () => {
  it("401 bez sesji", async () => {
    authState.loggedIn = false;
    const { status } = await parseResponse(await get());
    expect(status).toBe(401);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it("404 konto bez salonu", async () => {
    salonCtx.role = null;
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Salon not found" });
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.raw).not.toHaveBeenCalled();
  });

  it.each(["employee", "receptionist"] as const)(
    "403 z kodem dla roli %s, bez odczytu usługi i cen",
    async (role) => {
      salonCtx.role = role;
      const { status, body } = await parseResponse(await get());
      expect(status).toBe(403);
      expect(body).toEqual(OWNER_ONLY_READ);
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.raw).not.toHaveBeenCalled();
    }
  );

  it("200 właściciel: pracownik w odpowiedzi tylko z polami z białej listy", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    const employee = { id: "e1", firstName: "Ala", lastName: "Nowak", color: "#ff0000", role: "employee" };
    const tx = rawWith([{ price: { id: PRICE_UUID, customPrice: "80.00" }, employee, variant: null }]);

    const { status, body } = await parseResponse(await get());

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [{ id: PRICE_UUID, customPrice: "80.00", employee, variant: null }],
      count: 1,
    });
    const selection = (tx.select.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(selection.employee).toEqual({
      id: "employees.id",
      firstName: "employees.firstName",
      lastName: "employees.lastName",
      color: "employees.color",
      role: "employees.role",
    });
    expect(repo.salonIds.every((id) => id === TEST_IDS.SALON_UUID)).toBe(true);
  });

  it("200 właściciel: pusta lista", async () => {
    repo.findOne.mockResolvedValueOnce({ id: TEST_IDS.SERVICE_UUID });
    rawWith([]);
    const { status, body } = await parseResponse(await get());
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: [], count: 0 });
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

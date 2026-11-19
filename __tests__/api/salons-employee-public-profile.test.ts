/**
 * GET /api/salons/[id]/employees/[employeeId] — publiczny profil pracownika
 * (portal klienta, bez sesji). Odpowiedź nie może zawierać danych
 * kontaktowych pracownika (phone, email) — portal ich nie wyświetla,
 * a trasa jest dostępna dla każdego.
 *
 * Mocki wzorowane na __tests__/api/salon-modules.test.ts (chainMock
 * select().from().where()…, schema jako Proxy, drizzle-orm jako atrapy).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock niżej jest hoistowany przez vitest — trasa importuje już atrapy.
import { GET } from "@/app/api/salons/[id]/employees/[employeeId]/route";

const mockDbSelect = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  return {
    employees: createTable("employees"),
    services: createTable("services"),
    employeeServices: createTable("employeeServices"),
    reviews: createTable("reviews"),
    galleryPhotos: createTable("galleryPhotos"),
    salons: createTable("salons"),
    clients: createTable("clients"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  avg: vi.fn((...args: unknown[]) => ({ type: "avg", args })),
  count: vi.fn((...args: unknown[]) => ({ type: "count", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as Record<string, unknown>).then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return chain;
}

const SALON_ID = "salon-1";
const EMPLOYEE_ID = "employee-1";

const SALON_ROW = { id: SALON_ID, name: "Salon Testowy" };
const EMPLOYEE_ROW = {
  id: EMPLOYEE_ID,
  salonId: SALON_ID,
  firstName: "Anna",
  lastName: "Kowalska",
  role: "employee",
  photoUrl: null,
  color: "#3b82f6",
  phone: "+48500600700",
  email: "anna@example.com",
};

function call() {
  return GET(
    new Request(`http://localhost:3000/api/salons/${SALON_ID}/employees/${EMPLOYEE_ID}`),
    { params: Promise.resolve({ id: SALON_ID, employeeId: EMPLOYEE_ID }) }
  );
}

describe("GET /api/salons/[id]/employees/[employeeId] — publiczny profil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 — profil bez phone i email, z id, firstName, lastName, salon", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([SALON_ROW]))
      .mockReturnValueOnce(chainMock([EMPLOYEE_ROW]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([{ avgRating: null, reviewCount: 0 }]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("id", EMPLOYEE_ID);
    expect(body.data).toHaveProperty("firstName", "Anna");
    expect(body.data).toHaveProperty("lastName", "Kowalska");
    expect(body.data).toHaveProperty("salon", { id: SALON_ID, name: "Salon Testowy" });
    expect(body.data).not.toHaveProperty("phone");
    expect(body.data).not.toHaveProperty("email");
  });

  it("404 — salon nie istnieje", async () => {
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("404 — pracownik nie istnieje w tym salonie", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([SALON_ROW]))
      .mockReturnValueOnce(chainMock([]));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("500 — błąd bazy", async () => {
    mockDbSelect.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

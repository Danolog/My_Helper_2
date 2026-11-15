/**
 * assertSalonRefs — każde id z body musi należeć do salonu (P1, przegląd Ryana).
 *
 * Fałszywy `tx` odpowiada wierszami z "bazy" STORE zawężonej do salonu:
 * rekord zwraca się tylko, gdy zapytanie zawiera eq(id) ORAZ eq(salonId)
 * zgodny z salonem rekordu. Dzięki temu test łapie też regresję typu
 * "zapytanie bez filtra salonu" (rekord obcego salonu byłby wtedy widoczny).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// vi.mock jest hoistowany — import modułu dostaje mocki poniżej.
import { assertSalonRefs, SALON_REF_ERROR } from "@/lib/salon-refs";

const SALON_A = "11111111-1111-4111-8111-111111111111";
const SALON_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLIENT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const EMPLOYEE_A = "aaaaaaaa-0000-4000-8000-0000000000e1";
const EMPLOYEE_B = "bbbbbbbb-0000-4000-8000-0000000000e2";
const SERVICE_A = "aaaaaaaa-0000-4000-8000-0000000000f1";
const SERVICE_B = "bbbbbbbb-0000-4000-8000-0000000000f2";
const CATEGORY_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const CATEGORY_B = "bbbbbbbb-0000-4000-8000-0000000000c2";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

type Cond = { type: string; args: unknown[] };

const { STORE, queries, mockRaw, mockWarn } = vi.hoisted(() => {
  const STORE: Record<string, Array<{ id: string; salonId: string }>> = {};
  const queries: Array<{ table: string; where: unknown }> = [];
  const mockRaw = vi.fn();
  const mockWarn = vi.fn();
  return { STORE, queries, mockRaw, mockWarn };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => ({ _table: name, id: `${name}.id`, salonId: `${name}.salonId` });
  return {
    clients: table("clients"),
    employees: table("employees"),
    services: table("services"),
    serviceCategories: table("serviceCategories"),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => ({
    salonId,
    raw: (fn: (tx: unknown) => unknown) => mockRaw(salonId, fn),
  }),
}));

/** Wyciąga płaską listę warunków eq z drzewa and(...). */
function flatten(cond: unknown): Cond[] {
  const c = cond as Cond;
  if (c?.type === "and") return c.args.flatMap(flatten);
  return c?.type === "eq" ? [c] : [];
}

function fakeTx() {
  return {
    select: () => ({
      from: (table: { _table: string }) => ({
        where: (where: unknown) => ({
          limit: async () => {
            queries.push({ table: table._table, where });
            const eqs = flatten(where);
            const idEq = eqs.find((e) => e.args[0] === `${table._table}.id`);
            const salonEq = eqs.find((e) => e.args[0] === `${table._table}.salonId`);
            return (STORE[table._table] ?? [])
              .filter((r) => (idEq ? r.id === idEq.args[1] : true))
              .filter((r) => (salonEq ? r.salonId === salonEq.args[1] : true))
              .map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  };
}

async function expect400(res: Response | null) {
  expect(res).not.toBeNull();
  expect(res!.status).toBe(400);
  expect(await res!.json()).toEqual({ success: false, error: SALON_REF_ERROR });
}

describe("assertSalonRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries.length = 0;
    STORE.clients = [
      { id: CLIENT_A, salonId: SALON_A },
      { id: CLIENT_B, salonId: SALON_B },
    ];
    STORE.employees = [
      { id: EMPLOYEE_A, salonId: SALON_A },
      { id: EMPLOYEE_B, salonId: SALON_B },
    ];
    STORE.services = [
      { id: SERVICE_A, salonId: SALON_A },
      { id: SERVICE_B, salonId: SALON_B },
    ];
    STORE.serviceCategories = [
      { id: CATEGORY_A, salonId: SALON_A },
      { id: CATEGORY_B, salonId: SALON_B },
    ];
    mockRaw.mockImplementation((_salonId: string, fn: (tx: unknown) => unknown) => fn(fakeTx()));
  });

  it("happy path: wszystkie id z tego salonu -> null", async () => {
    const res = await assertSalonRefs(SALON_A, {
      clientId: CLIENT_A,
      employeeId: EMPLOYEE_A,
      serviceId: SERVICE_A,
      categoryId: CATEGORY_A,
    });
    expect(res).toBeNull();
    expect(queries.map((q) => q.table)).toEqual(["clients", "employees", "services", "serviceCategories"]);
  });

  it.each([
    ["clientId", CLIENT_B],
    ["employeeId", EMPLOYEE_B],
    ["serviceId", SERVICE_B],
    ["categoryId", CATEGORY_B],
  ])("%s innego salonu -> 400 z jednym komunikatem", async (key, foreignId) => {
    await expect400(await assertSalonRefs(SALON_A, { [key]: foreignId }));
  });

  it("nieistniejące id -> ten sam 400 co obce (bez zdradzania istnienia)", async () => {
    const foreign = await assertSalonRefs(SALON_A, { clientId: CLIENT_B });
    const unknown = await assertSalonRefs(SALON_A, { clientId: UNKNOWN });
    expect(await foreign!.json()).toEqual(await unknown!.json());
    expect(unknown!.status).toBe(400);
  });

  it("zły format id -> 400 bez zapytania do bazy", async () => {
    await expect400(await assertSalonRefs(SALON_A, { employeeId: "not-a-uuid" }));
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("jeden obcy wśród poprawnych -> 400", async () => {
    await expect400(
      await assertSalonRefs(SALON_A, { clientId: CLIENT_A, employeeId: EMPLOYEE_B, serviceId: SERVICE_A })
    );
  });

  it("puste wartości (undefined/null/'') są pomijane, brak zapytań", async () => {
    expect(await assertSalonRefs(SALON_A, {})).toBeNull();
    expect(await assertSalonRefs(SALON_A, { clientId: null, serviceId: "", employeeId: undefined })).toBeNull();
    expect(mockRaw).not.toHaveBeenCalled();
  });

  it("każde zapytanie jest zawężone do salonId (eq(table.salonId, salonId)) i idzie przez forSalon(salonId)", async () => {
    await assertSalonRefs(SALON_A, { clientId: CLIENT_A, employeeId: EMPLOYEE_A });
    expect(mockRaw).toHaveBeenCalledWith(SALON_A, expect.any(Function));
    for (const q of queries) {
      const salonEq = flatten(q.where).find((e) => e.args[0] === `${q.table}.salonId`);
      expect(salonEq?.args[1]).toBe(SALON_A);
    }
  });

  it("log serwera mówi, który ref odpadł; odpowiedź nie", async () => {
    const res = await assertSalonRefs(SALON_A, { employeeId: EMPLOYEE_B });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ref: "employeeId", reason: "not_in_salon", salonId: SALON_A })
    );
    expect(JSON.stringify(await res!.json())).not.toContain("employee");
  });

  it("błąd bazy propaguje się (trasa zwraca 500 w swoim catch)", async () => {
    mockRaw.mockRejectedValueOnce(new Error("DB down"));
    await expect(assertSalonRefs(SALON_A, { clientId: CLIENT_A })).rejects.toThrow("DB down");
  });
});

/**
 * F1 · Regresja IDOR na poziomie kolekcji (wyciek cross-tenant) — trasy
 * kolekcyjne GET i raporty `reports/*`.
 *
 * Luka (review Ethan/Ryan): trasy kolekcyjne (`clients`, `reports/*`, …) brały
 * `salonId` z parametru zapytania (`searchParams.get("salonId")`) + `requireAuth()`,
 * ale NIE weryfikowały, że ten salon należy do zalogowanego użytkownika.
 * Atakujący podawał cudzy `salonId` w query i widział dane innego salonu. RLS
 * tego NIE łapał, bo `forSalon(salonId)` ustawia kontekst RLS na WSTRZYKNIĘTY
 * salonId — baza ufała wartości z wejścia.
 *
 * Naprawa (wzorzec jak w trasach [id] po P0-A): salonId pochodzi z SESJI przez
 * `getUserSalonId()`, query jest ignorowane.
 *
 * Ten test dowodzi DWÓCH własności:
 *   1. Gdy atakujący poda cudzy `?salonId=<ofiara>`, zapytanie do bazy jest
 *      zawężone do salonu z SESJI — wartość z query NIGDY nie trafia do filtra
 *      `eq(table.salonId, …)`. (Brak wycieku cross-tenant.)
 *   2. Gdy zalogowany użytkownik nie ma salonu, trasa zwraca 404 i NIE odpytuje
 *      bazy w ogóle (fail-closed).
 *
 * Strategia: mockujemy `drizzle-orm` tak, że `eq`/`and` ZAPISUJĄ argumenty —
 * możemy więc sprawdzić, którym salonId zawężono zapytanie. `getUserSalonId`
 * jest mockowany jako źródło sesji (salon ofiary ≠ salon atakującego w query).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, makeClient, TEST_IDS } from "./helpers";

// `vi.hoisted` — te stałe trafiają do fabryk `vi.mock`, które vitest winduje na
// szczyt pliku PRZED zwykłymi `const`. Bez hoisted: "Cannot access
// 'SESSION_SALON' before initialization".
const { SESSION_SALON, ATTACKER_SALON } = vi.hoisted(() => ({
  // Salon zalogowanego użytkownika (z sesji) — jedyny, do którego wolno sięgać.
  // Musi być zgodny z TEST_IDS.SALON_UUID (fabryki danych makeClient itd.).
  SESSION_SALON: "11111111-1111-1111-1111-111111111111",
  // Salon OFIARY, który atakujący próbuje wstrzyknąć w query. Inny niż sesyjny.
  ATTACKER_SALON: "99999999-9999-9999-9999-999999999999",
}));

// -------------------------------------------------------
// Mocki
// -------------------------------------------------------

const mockDbSelect = vi.fn();

// `tx` w transakcji deleguje do tych samych mocków co `db` (warstwa repo forSalon).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "session-user", email: "owner@test.com" } },
    user: { id: "session-user", email: "owner@test.com" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// Źródło prawdy o salonie = SESJA. Flipujemy per test (null = brak salonu).
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(SESSION_SALON),
  getUserSalon: vi.fn().mockResolvedValue({ id: SESSION_SALON }),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy(
      {},
      { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) }
    );
  return {
    clients: createTable("clients"),
    appointments: createTable("appointments"),
    services: createTable("services"),
    employees: createTable("employees"),
  };
});

// `eq`/`and` ZAPISUJĄ argumenty — to po nich poznajemy, jakim salonId zawężono.
const capturedEqArgs: unknown[][] = [];
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => {
    capturedEqArgs.push(args);
    return { type: "eq", args };
  }),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  gte: vi.fn((...args: unknown[]) => ({ type: "gte", args })),
  lte: vi.fn((...args: unknown[]) => ({ type: "lte", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ type: "isNotNull", args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args, as: vi.fn(() => "sql_col") })),
    { raw: vi.fn((...args: unknown[]) => ({ type: "sql_raw", args })) }
  ),
}));

vi.mock("@/lib/excel-export", () => ({
  createExcelWorkbook: vi.fn(),
  excelResponseHeaders: {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "from", "where", "leftJoin", "innerJoin",
    "limit", "orderBy", "groupBy", "execute",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.as = vi.fn().mockReturnValue(
    new Proxy({}, { get: (_t, p) => (typeof p === "string" ? `sq.${p}` : undefined) })
  );
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Handlery
// -------------------------------------------------------
import { GET as listClients } from "@/app/api/clients/route";
import { GET as revenueReport } from "@/app/api/reports/revenue/route";
import { getUserSalonId } from "@/lib/get-user-salon";

const mockGetUserSalonId = vi.mocked(getUserSalonId);

/** Czy którykolwiek `eq(...)` zawęził po podanym salonId? */
function scopedToSalon(salonId: string): boolean {
  return capturedEqArgs.some((args) => args.includes(salonId));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedEqArgs.length = 0;
  mockGetUserSalonId.mockResolvedValue(SESSION_SALON);
});

// Niezmiennik: salon z sesji musi pokrywać się z fabrykami danych testowych —
// inaczej asercje "zawężono do sesji" badałyby zły UUID.
it("sanity: SESSION_SALON == TEST_IDS.SALON_UUID", () => {
  expect(SESSION_SALON).toBe(TEST_IDS.SALON_UUID);
});

// =======================================================
// F1 · clients (kolekcja)
// =======================================================
describe("F1 IDOR — GET /api/clients (kolekcja)", () => {
  it("ignoruje cudzy ?salonId w query i zawęża do salonu z SESJI", async () => {
    // subquery + main query
    mockDbSelect
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([{ client: makeClient(), lastVisit: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/clients?salonId=${ATTACKER_SALON}`
    );
    const response = await listClients(request);
    const { status } = await parseResponse(response);

    expect(status).toBe(200);
    // Filtr po salonie biegnie WYŁĄCZNIE na salonie z sesji…
    expect(scopedToSalon(SESSION_SALON)).toBe(true);
    // …a cudzy salonId z query NIGDY nie trafia do filtra (brak wycieku).
    expect(scopedToSalon(ATTACKER_SALON)).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });

  it("zwraca 404, gdy zalogowany użytkownik nie ma salonu (fail-closed)", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const request = createMockRequest(
      `http://localhost:3000/api/clients?salonId=${ATTACKER_SALON}`
    );
    const response = await listClients(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    // Bez salonu z sesji — żadnego zapytania do bazy.
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});

// =======================================================
// F1 · reports/revenue (raport)
// =======================================================
describe("F1 IDOR — GET /api/reports/revenue (raport)", () => {
  it("ignoruje cudzy ?salonId w query i raportuje TYLKO salon z SESJI", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/reports/revenue?salonId=${ATTACKER_SALON}&format=json`
    );
    const response = await revenueReport(request);
    const { status } = await parseResponse(response);

    expect(status).toBe(200);
    expect(scopedToSalon(SESSION_SALON)).toBe(true);
    expect(scopedToSalon(ATTACKER_SALON)).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });

  it("zwraca 404, gdy brak salonu w sesji — i nie odpytuje bazy", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const request = createMockRequest(
      `http://localhost:3000/api/reports/revenue?salonId=${ATTACKER_SALON}`
    );
    const response = await revenueReport(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});

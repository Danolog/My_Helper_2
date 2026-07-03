/**
 * Faza 2 — feature flags per salon: /api/salons/[id]/modules.
 *
 * GET zwraca rozwiązany stan modułów (defaults + zapis, hardOff zawsze false).
 * PUT zapisuje TYLKO znane, przełączalne klucze do settingsJson.modules —
 * hardOff i nieznane klucze są ignorowane. Autoryzacja jak w trasach
 * *-settings: requireAuth + ownerId === user.id (403 dla nie-właściciela).
 *
 * Mocki wzorowane na __tests__/api/salon-settings.test.ts (warstwa repo
 * forSalon otwiera db.transaction i woła tx.select/update/execute).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";
import { DEFAULT_MODULES } from "@/lib/features";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

// `tx` deleguje do tych samych mocków co `db` — warstwa repo (forSalon) otwiera
// db.transaction() i woła tx.select/update (ADR-001 R1).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  execute: vi.fn().mockResolvedValue(undefined), // SET LOCAL role / app.current_salon_id
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
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
  return { salons: createTable("salons") };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  // `sql` używa warstwa repo (forSalon): sql`...` do set_config oraz
  // sql.raw(...) do SET LOCAL ROLE — mock musi mieć oba.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: vi.fn().mockReturnValue(false),
}));

const mockValidateBody = vi.fn();
vi.mock("@/lib/api-validation", () => ({
  validateBody: (...args: unknown[]) => mockValidateBody(...args),
  salonModulesSchema: {},
}));

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["select", "from", "where", "limit", "update", "set", "returning"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as Record<string, unknown>).then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return chain;
}

const OWNER_ID = "owner-A";
const OTHER_USER_ID = "other-user-B";
const URL_BASE = `http://localhost:3000/api/salons/${TEST_IDS.SALON_UUID}/modules`;

import { GET as getModules, PUT as putModules } from "@/app/api/salons/[id]/modules/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("/api/salons/[id]/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBody.mockReturnValue(null);
  });

  it("GET zwraca defaults (wszystko false) dla pustego settingsJson", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const response = await getModules(
      createMockRequest(URL_BASE),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(DEFAULT_MODULES);
  });

  it("GET zwraca 403 dla zalogowanego NIE-wlasciciela", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const response = await getModules(
      createMockRequest(URL_BASE),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("uprawnien");
  });

  it("PUT zapisuje przelaczalne klucze i ignoruje hardOff/nieznane", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );
    const updateChain = chainMock([{ id: TEST_IDS.SALON_UUID }]);
    mockDbUpdate.mockReturnValue(updateChain);

    const response = await putModules(
      createMockRequest(URL_BASE, {
        method: "PUT",
        body: {
          modules: {
            products: true, // przelaczalny => zapisany
            voiceAi: true, // hardOff => ignorowany
            notAModule: true, // nieznany => ignorowany
          },
        },
      }),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Do settingsJson.modules trafil TYLKO przelaczalny klucz.
    expect(updateChain.set).toHaveBeenCalledWith({
      settingsJson: { modules: { products: true } },
    });

    // Odpowiedz zwraca rozwiazany stan: products wlaczony, hardOff nadal false.
    const data = body.data as Record<string, boolean>;
    expect(data.products).toBe(true);
    expect(data.voiceAi).toBe(false);
    expect(data.notAModule).toBeUndefined();
  });

  it("PUT zwraca 400 przy zlym body i nie dotyka bazy", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockValidateBody.mockReturnValue({
      success: false,
      error: "Nieprawidlowe dane",
    });

    const response = await putModules(
      createMockRequest(URL_BASE, {
        method: "PUT",
        body: { modules: "not-an-object" },
      }),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("PUT zwraca 404, gdy salon nie istnieje", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockDbSelect.mockReturnValue(chainMock([]));

    const response = await putModules(
      createMockRequest(URL_BASE, {
        method: "PUT",
        body: { modules: { products: true } },
      }),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("PUT zwraca 403 dla NIE-wlasciciela i nie wykonuje update", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const response = await putModules(
      createMockRequest(URL_BASE, {
        method: "PUT",
        body: { modules: { products: true } },
      }),
      createRouteParams(TEST_IDS.SALON_UUID)
    );
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

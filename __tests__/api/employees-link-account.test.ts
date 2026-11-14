/**
 * Faza 3 — łączenie konta użytkownika z pracownikiem:
 * PUT /api/employees/[id]/link-account.
 *
 * Tylko właściciel salonu (getUserSalonId). Body { email: string | null }:
 * email => podpięcie konta (404 brak konta, 409 konto już podpięte pod innego
 * pracownika, 409 konto właściciela salonu), null => odłączenie.
 *
 * Mocki wzorowane na __tests__/api/salon-modules.test.ts (warstwa repo
 * forSalon otwiera db.transaction i woła tx.select/update/execute).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  TEST_IDS,
  makeEmployee,
} from "./helpers";

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
  return {
    employees: createTable("employees"),
    salons: createTable("salons"),
    user: createTable("user"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  ne: vi.fn((...args: unknown[]) => ({ type: "ne", args })),
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
  linkEmployeeAccountSchema: {},
}));

const mockRevokeSalonGrants = vi.fn();
vi.mock("@/lib/temporary-access", () => ({
  revokeSalonGrantsForUser: (...args: unknown[]) => mockRevokeSalonGrants(...args),
}));

const mockGetUserSalonId = vi.fn();
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
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
const LINKED_USER_ID = "user-777";
const URL_BASE = `http://localhost:3000/api/employees/${TEST_IDS.EMPLOYEE_UUID}/link-account`;

import { PUT as putLinkAccount } from "@/app/api/employees/[id]/link-account/route";

function callPut(body: unknown) {
  return putLinkAccount(
    createMockRequest(URL_BASE, { method: "PUT", body }),
    createRouteParams(TEST_IDS.EMPLOYEE_UUID)
  );
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("PUT /api/employees/[id]/link-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBody.mockReturnValue(null);
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockGetUserSalonId.mockResolvedValue(TEST_IDS.SALON_UUID);
    mockDbSelect.mockReturnValue(chainMock([]));
    mockRevokeSalonGrants.mockResolvedValue(0);
  });

  it("happy path: podpina istniejace konto do pracownika salonu", async () => {
    // Kolejnosc selectow: findOne(employees) -> user po emailu ->
    // konto podpiete pod INNEGO pracownika -> salon wlascicielski konta.
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee()]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID, emailVerified: true }]))
      .mockReturnValueOnce(chainMock([])) // nie podpiety pod innego pracownika
      .mockReturnValueOnce(chainMock([])); // nie jest wlascicielem zadnego salonu
    const updateChain = chainMock([makeEmployee({ userId: LINKED_USER_ID })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const response = await callPut({ email: "anna@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).userId).toBe(LINKED_USER_ID);
    expect(updateChain.set).toHaveBeenCalledWith({ userId: LINKED_USER_ID });
  });

  it("zwraca 404, gdy brak salonu wlascicielskiego (pracownik/obcy user)", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const response = await callPut({ email: "anna@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("zwraca 404 dla pracownika spoza salonu wolajacego (cudzy/nieistniejacy)", async () => {
    mockDbSelect.mockReturnValueOnce(chainMock([])); // findOne => brak w MOIM salonie

    const response = await callPut({ email: "anna@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Nie znaleziono pracownika");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("zwraca 404, gdy konto o podanym emailu nie istnieje", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee()]))
      .mockReturnValueOnce(chainMock([])); // brak usera o tym emailu

    const response = await callPut({ email: "nieistnieje@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Nie znaleziono konta o tym adresie e-mail");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  // Konto znalezione po e-mailu podpinamy tylko przy potwierdzonym adresie:
  // inaczej ktos, kto zalozy konto na e-mail przyszlego pracownika, dostanie
  // po podpieciu dostep pracownika do salonu (straznik jak src/lib/client-match.ts).
  it("zwraca 409 z czytelnym bledem, gdy konto ma niepotwierdzony e-mail (bez podpiecia)", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee()]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID, emailVerified: false }]));
    mockDbUpdate.mockReturnValue(chainMock([makeEmployee({ userId: LINKED_USER_ID })]));

    const response = await callPut({ email: "anna@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("nie ma potwierdzonego adresu e-mail");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("zwraca 409, gdy konto jest juz podpiete pod innego pracownika", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee()]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID, emailVerified: true }]))
      .mockReturnValueOnce(chainMock([{ id: "emp-w-innym-salonie" }])); // juz podpiety

    const response = await callPut({ email: "anna@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("przypisane do innego pracownika");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("zwraca 409, gdy konto nalezy do wlasciciela salonu", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee()]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID, emailVerified: true }]))
      .mockReturnValueOnce(chainMock([])) // nie podpiety pod innego pracownika
      .mockReturnValueOnce(chainMock([{ id: "salon-innego-wlasciciela" }])); // wlasciciel

    const response = await callPut({ email: "wlasciciel@konto.pl" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Wlasciciel salonu");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("email=null odlacza konto od pracownika bez lookupu usera", async () => {
    mockDbSelect.mockReturnValueOnce(
      chainMock([makeEmployee({ userId: LINKED_USER_ID })])
    );
    const updateChain = chainMock([makeEmployee({ userId: null })]);
    mockDbUpdate.mockReturnValue(updateChain);

    const response = await callPut({ email: null });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(updateChain.set).toHaveBeenCalledWith({ userId: null });
    // Tylko findOne — zadnych zapytan o user/salons przy odlaczaniu.
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it("email=null kasuje granty czasowe nadane temu kontu przez wlasciciela salonu", async () => {
    mockDbSelect.mockReturnValueOnce(
      chainMock([makeEmployee({ userId: LINKED_USER_ID })])
    );
    mockDbUpdate.mockReturnValue(chainMock([makeEmployee({ userId: null })]));

    const response = await callPut({ email: null });

    expect(response.status).toBe(200);
    // Tylko granty TEGO salonu (granted_by = wlasciciel z sesji) dla odpinanego konta.
    expect(mockRevokeSalonGrants).toHaveBeenCalledWith(LINKED_USER_ID, OWNER_ID);
  });

  it("email=null na pracowniku bez konta nie kasuje niczego", async () => {
    mockDbSelect.mockReturnValueOnce(chainMock([makeEmployee({ userId: null })]));
    mockDbUpdate.mockReturnValue(chainMock([makeEmployee({ userId: null })]));

    const response = await callPut({ email: null });

    expect(response.status).toBe(200);
    expect(mockRevokeSalonGrants).not.toHaveBeenCalled();
  });

  it("przepiecie na inne konto kasuje granty poprzedniego konta", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee({ userId: "user-old" })]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID }]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]));
    mockDbUpdate.mockReturnValue(chainMock([makeEmployee({ userId: LINKED_USER_ID })]));

    const response = await callPut({ email: "anna@konto.pl" });

    expect(response.status).toBe(200);
    expect(mockRevokeSalonGrants).toHaveBeenCalledWith("user-old", OWNER_ID);
  });

  it("ponowne podpiecie tego samego konta nie kasuje jego grantow", async () => {
    mockDbSelect
      .mockReturnValueOnce(chainMock([makeEmployee({ userId: LINKED_USER_ID })]))
      .mockReturnValueOnce(chainMock([{ id: LINKED_USER_ID }]))
      .mockReturnValueOnce(chainMock([]))
      .mockReturnValueOnce(chainMock([]));
    mockDbUpdate.mockReturnValue(chainMock([makeEmployee({ userId: LINKED_USER_ID })]));

    const response = await callPut({ email: "anna@konto.pl" });

    expect(response.status).toBe(200);
    expect(mockRevokeSalonGrants).not.toHaveBeenCalled();
  });
});

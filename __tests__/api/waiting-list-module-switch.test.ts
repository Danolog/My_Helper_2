/**
 * Trasy personelu listy oczekujących: /api/waiting-list i /api/waiting-list/[id].
 *
 * Przełącznik modułu listy oczekujących (per salon) obowiązuje w każdej
 * metodzie poza usunięciem wpisu: po autoryzacji i ustaleniu salonu, przed
 * odczytem treści żądania i jakimkolwiek dostępem do danych listy. Wyłączony
 * moduł → 404 `MODULE_DISABLED`; włączony → metoda działa jak dotąd.
 * Usunięcie wpisu (`DELETE /api/waiting-list/[id]`) działa także przy
 * wyłączonym module i nie czyta przełącznika.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { MODULE_DISABLED_CODE, MODULE_DISABLED_MESSAGE } from "@/lib/features";
import { createMockRequest, createRouteParams } from "./helpers";

const SALON_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

const {
  mockRequireAuth,
  mockGetSession,
  mockGetUserSalon,
  mockGetSalonModules,
  mockForSalon,
  gate,
} = vi.hoisted(() => {
  const gate = {
    raw: vi.fn(async () => [] as unknown[]),
    findOne: vi.fn(async () => ({ id: "row" }) as unknown),
    updateOwned: vi.fn(async () => ({ id: "row" }) as unknown),
    deleteOwned: vi.fn(async () => ({ id: "row" }) as unknown),
  };
  return {
    mockRequireAuth: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetUserSalon: vi.fn(),
    mockGetSalonModules: vi.fn(),
    mockForSalon: vi.fn(() => gate),
    gate,
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: (r: unknown) => r instanceof NextResponse,
  requireCronSecret: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalon: (...a: unknown[]) => mockGetUserSalon(...a),
}));
vi.mock("@/lib/server/modules", () => ({
  getSalonModules: (...a: unknown[]) => mockGetSalonModules(...a),
}));
vi.mock("@/lib/server/repository", () => ({
  forSalon: (...a: unknown[]) => mockForSalon(...(a as [])),
}));
vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return {
    waitingList: table("waitingList"),
    clients: table("clients"),
    services: table("services"),
    employees: table("employees"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  isNull: vi.fn((...args: unknown[]) => ({ type: "isNull", args })),
  isNotNull: vi.fn((...args: unknown[]) => ({ type: "isNotNull", args })),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET as listEntries, POST as createEntry } from "@/app/api/waiting-list/route";
import {
  GET as getEntry,
  PUT as updateEntry,
  DELETE as deleteEntry,
} from "@/app/api/waiting-list/[id]/route";

const BASE = "http://localhost:3000/api/waiting-list";

type Call = (body?: unknown) => Promise<Response>;

/** Każda z pięciu metod: wywołanie z poprawną albo podaną treścią żądania. */
const METHODS: Array<{ name: string; call: Call; validBody?: unknown; invalidBody?: unknown }> = [
  {
    name: "GET /api/waiting-list",
    call: () => listEntries(createMockRequest(BASE)),
  },
  {
    name: "POST /api/waiting-list",
    call: (body) => createEntry(createMockRequest(BASE, { method: "POST", body })),
    validBody: { clientId: CLIENT_ID, clientRequestConfirmed: true },
    invalidBody: { serviceId: 123 },
  },
  {
    name: "GET /api/waiting-list/[id]",
    call: () =>
      getEntry(createMockRequest(`${BASE}/${ENTRY_ID}`), createRouteParams(ENTRY_ID)),
  },
  {
    name: "PUT /api/waiting-list/[id]",
    call: (body) =>
      updateEntry(
        createMockRequest(`${BASE}/${ENTRY_ID}`, { method: "PUT", body }),
        createRouteParams(ENTRY_ID)
      ),
    validBody: { accepted: true },
    invalidBody: { accepted: "tak" },
  },
];

const CASES = METHODS.map((m) => [m.name, m] as const);

/** Usunięcie wpisu nie zależy od przełącznika modułu. */
const DELETE_NAME = "DELETE /api/waiting-list/[id]";
const callDelete = () =>
  deleteEntry(
    createMockRequest(`${BASE}/${ENTRY_ID}`, { method: "DELETE" }),
    createRouteParams(ENTRY_ID)
  );
const ORDER_CASES = [
  ...CASES,
  [DELETE_NAME, { name: DELETE_NAME, call: callDelete } as (typeof METHODS)[number]] as const,
];

function setModule(enabled: boolean) {
  mockGetSalonModules.mockResolvedValue({ waitingList: enabled });
}

beforeEach(() => {
  vi.clearAllMocks();
  const user = { id: "user-1", email: "wlasciciel@example.com" };
  mockRequireAuth.mockResolvedValue({ session: { user }, user });
  mockGetSession.mockResolvedValue({ session: { id: "s1" }, user });
  mockGetUserSalon.mockResolvedValue({ id: SALON_ID });
  gate.raw.mockResolvedValue([]);
  gate.findOne.mockResolvedValue({ id: "row" });
  gate.updateOwned.mockResolvedValue({ id: ENTRY_ID });
  gate.deleteOwned.mockResolvedValue({ id: ENTRY_ID });
});

describe("moduł listy oczekujących wyłączony → 404 bez dostępu do danych", () => {
  it.each(CASES)("%s", async (_name, m) => {
    setModule(false);

    const response = await m.call(m.validBody);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      code: MODULE_DISABLED_CODE,
      error: MODULE_DISABLED_MESSAGE,
    });
    expect(mockGetSalonModules).toHaveBeenCalledWith(SALON_ID);
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(gate.raw).not.toHaveBeenCalled();
    expect(gate.findOne).not.toHaveBeenCalled();
    expect(gate.updateOwned).not.toHaveBeenCalled();
    expect(gate.deleteOwned).not.toHaveBeenCalled();
  });

  it.each(METHODS.filter((m) => m.invalidBody !== undefined).map((m) => [m.name, m] as const))(
    "%s z niepoprawną treścią żądania → 404, nie 400",
    async (_name, m) => {
      setModule(false);

      const response = await m.call(m.invalidBody);

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe(MODULE_DISABLED_CODE);
      expect(mockForSalon).not.toHaveBeenCalled();
    }
  );
});

describe("moduł listy oczekujących włączony → metoda działa dalej", () => {
  it.each(CASES)("%s", async (_name, m) => {
    setModule(true);

    const response = await m.call(m.validBody);
    const body = await response.json();

    expect(mockGetSalonModules).toHaveBeenCalledWith(SALON_ID);
    expect(mockForSalon).toHaveBeenCalledWith(SALON_ID);
    expect(body.code).not.toBe(MODULE_DISABLED_CODE);
  });

  it("niepoprawna treść POST przy włączonym module → 400", async () => {
    setModule(true);
    const response = await createEntry(
      createMockRequest(BASE, { method: "POST", body: { serviceId: 123 } })
    );
    expect(response.status).toBe(400);
    expect(mockForSalon).not.toHaveBeenCalled();
  });
});

describe("usunięcie wpisu przy wyłączonym module", () => {
  it("wpis własnego salonu → 200, usunięcie przez bramę salonu z sesji", async () => {
    setModule(false);

    const response = await callDelete();

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mockForSalon).toHaveBeenCalledWith(SALON_ID);
    expect(gate.deleteOwned).toHaveBeenCalledTimes(1);
    expect(gate.deleteOwned).toHaveBeenCalledWith(expect.anything(), ENTRY_ID);
  });

  it("wpisu nie ma w salonie → zwykłe 404 bez kodu wyłączonego modułu", async () => {
    setModule(false);
    gate.deleteOwned.mockResolvedValue(undefined);

    const response = await callDelete();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBeUndefined();
    expect(body.error).not.toBe(MODULE_DISABLED_MESSAGE);
  });

  it("bez sesji → 401 bez usuwania", async () => {
    setModule(false);
    mockGetSession.mockResolvedValue(null);

    const response = await callDelete();

    expect(response.status).toBe(401);
    expect(gate.deleteOwned).not.toHaveBeenCalled();
  });

  it("bez salonu → 403 bez usuwania", async () => {
    setModule(false);
    mockGetUserSalon.mockResolvedValue(null);

    const response = await callDelete();

    expect(response.status).toBe(403);
    expect(gate.deleteOwned).not.toHaveBeenCalled();
  });

  it("przełącznik modułu nie jest czytany", async () => {
    setModule(false);

    await callDelete();

    expect(mockGetSalonModules).not.toHaveBeenCalled();
  });
});

describe("kolejność statusów: 401 i 403 przed sprawdzeniem modułu", () => {
  it.each(ORDER_CASES)("%s bez sesji → 401", async (_name, m) => {
    setModule(false);
    mockGetSession.mockResolvedValue(null);

    const response = await m.call(m.validBody);

    expect(response.status).toBe(401);
    expect(mockGetSalonModules).not.toHaveBeenCalled();
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it.each(ORDER_CASES)("%s bez sesji w warstwie wspólnej → 401", async (_name, m) => {
    setModule(false);
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Brak autoryzacji" }, { status: 401 })
    );

    const response = await m.call(m.validBody);

    expect(response.status).toBe(401);
    expect(mockGetSalonModules).not.toHaveBeenCalled();
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it.each(ORDER_CASES)("%s bez salonu → 403", async (_name, m) => {
    setModule(false);
    mockGetUserSalon.mockResolvedValue(null);

    const response = await m.call(m.validBody);

    expect(response.status).toBe(403);
    expect(mockGetSalonModules).not.toHaveBeenCalled();
    expect(mockForSalon).not.toHaveBeenCalled();
  });
});

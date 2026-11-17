/**
 * Trasy personelu listy oczekujących — źródło wpisu i potwierdzenie prośby klienta (#221).
 *
 * - POST /api/waiting-list wymaga `clientRequestConfirmed: true`; kolumny
 *   `source`, `clientRequestConfirmedAt` i `createdByUserId` ustawia wyłącznie
 *   serwer (`"staff"`, bieżący czas, konto z sesji). Te pola w treści → 400.
 * - PUT /api/waiting-list/[id] nie zmienia źródła ani potwierdzenia: pola te
 *   w treści nie trafiają do zapisu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, createRouteParams } from "./helpers";

const SALON_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user-1";
const NOW = new Date("2026-11-17T09:30:00.000Z");
const CONFIRM_MESSAGE = "Potwierdź, że klient sam poprosił o zapis na listę oczekujących.";

const {
  mockRequireAuth,
  mockGetSession,
  mockGetUserSalon,
  mockGetSalonModules,
  mockForSalon,
  gate,
  insertValues,
} = vi.hoisted(() => {
  const insertValues = vi.fn((_v: unknown) => undefined);
  const tx = {
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertValues(v);
        return { returning: async () => [{ id: "nowy-wpis" }] };
      },
    })),
  };
  const gate = {
    raw: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    findOne: vi.fn(async (..._a: unknown[]) => ({ id: "row" }) as unknown),
    updateOwned: vi.fn(async (..._a: unknown[]) => ({ id: "row" }) as unknown),
  };
  return {
    mockRequireAuth: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetUserSalon: vi.fn(),
    mockGetSalonModules: vi.fn(),
    mockForSalon: vi.fn(() => gate),
    gate,
    insertValues,
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

import { POST as createEntry } from "@/app/api/waiting-list/route";
import { PUT as updateEntry } from "@/app/api/waiting-list/[id]/route";

const BASE = "http://localhost:3000/api/waiting-list";

function post(body: unknown) {
  return createEntry(createMockRequest(BASE, { method: "POST", body }));
}

function put(body: unknown) {
  return updateEntry(
    createMockRequest(`${BASE}/${ENTRY_ID}`, { method: "PUT", body }),
    createRouteParams(ENTRY_ID)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const user = { id: USER_ID, email: "wlasciciel@example.com" };
  mockRequireAuth.mockResolvedValue({ session: { user }, user });
  mockGetSession.mockResolvedValue({ session: { id: "s1" }, user });
  mockGetUserSalon.mockResolvedValue({ id: SALON_ID });
  mockGetSalonModules.mockResolvedValue({ waitingList: true });
  gate.findOne.mockResolvedValue({ id: "row" });
  gate.updateOwned.mockResolvedValue({ id: ENTRY_ID });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/waiting-list — wpis personelu z potwierdzeniem prośby klienta", () => {
  it("poprawna treść → 201, źródło, czas potwierdzenia i autor ustawione przez serwer", async () => {
    const response = await post({
      clientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      clientRequestConfirmed: true,
    });

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const values = insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(values).toMatchObject({
      salonId: SALON_ID,
      clientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      source: "staff",
      createdByUserId: USER_ID,
    });
    expect(values.clientRequestConfirmedAt).toBeInstanceOf(Date);
    expect((values.clientRequestConfirmedAt as Date).getTime()).toBe(NOW.getTime());
    expect(values).not.toHaveProperty("clientRequestConfirmed");
  });

  it.each([
    ["bez pola potwierdzenia", { clientId: CLIENT_ID }],
    ["z potwierdzeniem false", { clientId: CLIENT_ID, clientRequestConfirmed: false }],
  ])("%s → 400 z komunikatem, bez dostępu do danych", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.details.clientRequestConfirmed).toBe(CONFIRM_MESSAGE);
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(gate.findOne).not.toHaveBeenCalled();
    expect(gate.raw).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it.each([
    ["source", "client_portal"],
    ["source", "client"],
    ["createdByUserId", "inny-uzytkownik"],
    ["clientRequestConfirmedAt", "2020-01-01T00:00:00Z"],
  ])("pole %s = %s w treści → 400, bez wstawienia", async (field, value) => {
    const response = await post({
      clientId: CLIENT_ID,
      clientRequestConfirmed: true,
      [field]: value,
    });

    expect(response.status).toBe(400);
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(gate.raw).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("PUT /api/waiting-list/[id] — źródło i potwierdzenie bez zmian", () => {
  it("pola źródła i potwierdzenia w treści nie trafiają do zapisu", async () => {
    const response = await put({
      accepted: true,
      source: "client",
      clientRequestConfirmedAt: null,
      createdByUserId: "inny",
      clientRequestConfirmed: false,
    });

    expect(response.status).toBe(200);
    expect(gate.updateOwned).toHaveBeenCalledTimes(1);
    expect(gate.updateOwned.mock.calls[0]![2]).toEqual({ accepted: true });
  });

  it("same pola źródła i potwierdzenia → 400 „Brak danych do aktualizacji”", async () => {
    const response = await put({
      source: "client",
      clientRequestConfirmedAt: null,
      createdByUserId: "inny",
      clientRequestConfirmed: true,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Brak danych do aktualizacji");
    expect(gate.updateOwned).not.toHaveBeenCalled();
  });
});

/**
 * POST /api/deposits/create-session: referencje z body muszą należeć do salonu (P1, audyt bezpieczeństwa).
 *
 * Przed naprawą:
 * - employeeId nie był sprawdzany, więc obcy pracownik (z innego salonu) dostawał
 *   wizytę "scheduled", która blokowała jego termin przez cały czas życia sesji
 *   Checkout (do webhooka expired albo crona cleanup),
 * - clientId od gościa/klienta portalu był przyjmowany (wystarczyło, że należy
 *   do salonu), więc do wizyty dało się podpiąć cudzą kartotekę klienta.
 *
 * Wzorzec z #39: assertSalonRefs (prawdziwy, przez prawdziwe forSalon), a
 * clientId tylko od personelu tego salonu. Mockowane są tylko krawędzie: db,
 * sesja, kontekst salonu, kalkulacja zadatku, Stripe (nieskonfigurowany, więc
 * zero wywołań Stripe, zostaje symulacja dev).
 *
 * Dwa strumienie wyników bazy:
 *   - routeRows: db.select() trasy (kolizje, time blocks, stary lookup klienta),
 *   - refRows:   tx.select() w forSalon (zapytania assertSalonRefs, kolejność
 *                clientId -> employeeId -> serviceId).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SALON_REF_ERROR } from "@/lib/salon-refs";
import { createMockRequest, parseResponse } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const OTHER_SALON = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const SERVICE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => {
  const routeRows: unknown[][] = [];
  const refRows: unknown[][] = [];
  const insertedValues: Record<string, unknown>[] = [];

  function chain(queue: unknown[][]): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "from", "where", "limit", "insert", "update", "set", "delete", "returning"]) {
      c[m] = () => c;
    }
    c.values = (v: Record<string, unknown>) => {
      insertedValues.push(v);
      return c;
    };
    c.then = (res: (r: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(res, rej);
    return c;
  }

  // insert w transakcji trasy zwraca wiersz z id (appointment, potem payment)
  function insertChain(): Record<string, unknown> {
    const c = chain([]);
    c.then = (res: (r: unknown[]) => unknown) =>
      res([{ id: `row-${insertedValues.length}`, ...insertedValues.at(-1) }]);
    return c;
  }

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => chain(refRows)),
    insert: () => insertChain(),
  };

  return {
    routeRows,
    refRows,
    insertedValues,
    tx,
    getOptionalSession: vi.fn(),
    getSalonContext: vi.fn(),
    calcDeposit: vi.fn(),
    db: {
      select: vi.fn(() => chain(routeRows)),
      update: () => chain([]),
      delete: () => chain([]),
      transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/session", () => ({ getOptionalSession: h.getOptionalSession }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: h.getSalonContext }));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: h.calcDeposit }));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: () => false,
  getStripe: () => {
    throw new Error("Stripe nie moze byc wolany w tym tescie");
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: () => ({ success: true, remaining: 4, reset: 60000 }) },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/server/frozen-guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/frozen-guard")>()),
  frozenModuleResponse: () => null, // trasa testowana bez blokady modułu
}));

import { POST } from "@/app/api/deposits/create-session/route";

const body = {
  salonId: SALON,
  employeeId: EMPLOYEE,
  serviceId: SERVICE,
  startTime: "2026-12-01T10:00:00.000Z",
  endTime: "2026-12-01T11:00:00.000Z",
  depositAmount: 50,
  paymentMethod: "stripe",
  guestName: "Anna Gosc",
  guestPhone: "500600700",
};

function post(extra: Record<string, unknown> = {}) {
  return POST(
    createMockRequest("http://localhost:3000/api/deposits/create-session", {
      method: "POST",
      body: { ...body, ...extra },
    })
  );
}

const appointmentInsert = () =>
  h.insertedValues.find((v) => "employeeId" in v) as Record<string, unknown> | undefined;

function asGuest() {
  h.getOptionalSession.mockResolvedValue(null);
  h.getSalonContext.mockResolvedValue(null);
}
function asPortalClient() {
  h.getOptionalSession.mockResolvedValue({ user: { id: "client-u", email: "k@test.pl" } });
  h.getSalonContext.mockResolvedValue(null);
}
function asStaffOf(salonId: string) {
  h.getOptionalSession.mockResolvedValue({ user: { id: "staff-u", email: "s@test.pl" } });
  h.getSalonContext.mockResolvedValue({ salonId, role: "receptionist", employeeId: "e-x", userId: "staff-u" });
}

// #69: flaga symulacji nie przecieka między testami.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/deposits/create-session: referencje salonu", () => {
  beforeEach(() => {
    // #69: symulacja bez klucza Stripe jest opt-in (vitest: NODE_ENV=test).
    vi.stubEnv("ALLOW_PAYMENT_SIMULATION", "1");
    h.routeRows.length = 0;
    h.refRows.length = 0;
    h.insertedValues.length = 0;
    h.tx.select.mockClear();
    h.db.select.mockClear();
    h.calcDeposit.mockReset();
    h.calcDeposit.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
  });

  it("obcy employeeId => 400, zero sondowania kalendarza i zero zapisu", async () => {
    asGuest();
    h.refRows.push([]); // employeeId: brak w salonie

    const res = await post();
    const { status, body: json } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(400);
    expect(json.error).toBe(SALON_REF_ERROR);
    expect(h.db.select).not.toHaveBeenCalled(); // kolizje/time blocks nie ruszone
    expect(h.calcDeposit).not.toHaveBeenCalled();
    expect(h.insertedValues).toEqual([]);
  });

  it("obcy serviceId => ten sam 400 (bez zdradzania, który ref)", async () => {
    asGuest();
    h.refRows.push([{ id: EMPLOYEE }], []); // pracownik OK, usługa obca

    const res = await post();
    const { status, body: json } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(400);
    expect(json.error).toBe(SALON_REF_ERROR);
    expect(h.insertedValues).toEqual([]);
  });

  it("gość: clientId z body ignorowany (wizyta z clientId null, bez lookupu klienta)", async () => {
    asGuest();
    h.refRows.push([{ id: EMPLOYEE }], [{ id: SERVICE }]);

    const res = await post({ clientId: CLIENT });

    expect(res.status).toBe(201);
    expect(appointmentInsert()?.clientId).toBeNull();
    expect(appointmentInsert()?.employeeId).toBe(EMPLOYEE);
    // assertSalonRefs pytał tylko o pracownika i usługę
    expect(h.tx.select).toHaveBeenCalledTimes(2);
  });

  it("klient portalu (sesja bez salonu): clientId z body ignorowany", async () => {
    asPortalClient();
    h.refRows.push([{ id: EMPLOYEE }], [{ id: SERVICE }]);

    const res = await post({ clientId: CLIENT });

    expect(res.status).toBe(201);
    expect(appointmentInsert()?.clientId).toBeNull();
  });

  it("personel innego salonu: clientId ignorowany (nie jest personelem TEGO salonu)", async () => {
    asStaffOf(OTHER_SALON);
    h.refRows.push([{ id: EMPLOYEE }], [{ id: SERVICE }]);

    const res = await post({ clientId: CLIENT });

    expect(res.status).toBe(201);
    expect(appointmentInsert()?.clientId).toBeNull();
  });

  it("personel tego salonu: klient z salonu zostaje podpięty", async () => {
    asStaffOf(SALON);
    h.refRows.push([{ id: CLIENT }], [{ id: EMPLOYEE }], [{ id: SERVICE }]);

    const res = await post({ clientId: CLIENT });

    expect(res.status).toBe(201);
    expect(appointmentInsert()?.clientId).toBe(CLIENT);
  });

  it("personel tego salonu: obcy klient => 400", async () => {
    asStaffOf(SALON);
    h.refRows.push([]); // clientId: brak w salonie

    const res = await post({ clientId: CLIENT });

    expect(res.status).toBe(400);
    expect(h.insertedValues).toEqual([]);
  });

  it("happy path gościa: 201, symulacja dev (zero Stripe), refs przez forSalon(salonId)", async () => {
    asGuest();
    h.refRows.push([{ id: EMPLOYEE }], [{ id: SERVICE }]);

    const res = await post();
    const { status, body: json } = await parseResponse<{ data: { simulated: boolean } }>(res);

    expect(status).toBe(201);
    expect(json.data.simulated).toBe(true);
    const rlsSalon = h.tx.execute.mock.calls
      .flatMap(([q]) => (q as { queryChunks?: unknown[] }).queryChunks ?? [])
      .filter((c) => typeof c === "string" && /^[0-9a-f-]{36}$/.test(c));
    expect(new Set(rlsSalon)).toEqual(new Set([SALON]));
  });
});

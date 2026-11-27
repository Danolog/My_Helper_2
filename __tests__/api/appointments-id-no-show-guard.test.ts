/**
 * PUT i DELETE /api/appointments/[id] — „Nie przyszedł” tylko przez trasę
 * /api/appointments/[id]/no-show.
 *
 * PUT ze statusem `no_show` albo zmiana statusu wizyty już oznaczonej → 400
 * `NO_SHOW_DEDICATED_ROUTE`, nic nie zapisane (inaczej pracownik oznaczałby
 * własną wizytę, a reguła dnia wizyty byłaby do obejścia). Edycja innych pól
 * (notatka, godzina) przy wizycie oznaczonej działa jak dotąd. DELETE
 * (anulowanie) wizyty oznaczonej → 400: najpierw cofnięcie oznaczenia.
 *
 * Atrapą jest baza (forSalon), sesja i kontekst salonu — wzorzec jak
 * appointments-id-deposits-disabled.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, makeAppointment, parseResponse, TEST_IDS } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  findOne: vi.fn(),
  /** Wynik każdego tx.select (PUT: kolizje i blokady; DELETE: odczyt wizyty). */
  selectRows: [] as Record<string, unknown>[],
  update: vi.fn(),
  set: vi.fn(),
  updated: [] as Record<string, unknown>[],
  cancelInTx: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => h.auth(...a),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/server/repository", () => {
  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "leftJoin", "innerJoin", "for"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(h.selectRows);
    return chain;
  };
  const update = (table: unknown) => {
    h.update(table);
    const chain: Record<string, unknown> = {};
    chain.set = (data: unknown) => {
      h.set(data);
      return chain;
    };
    chain.where = () => chain;
    chain.returning = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(h.updated);
    return chain;
  };
  const tx = { select, update };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      findOne: (...a: unknown[]) => h.findOne(...a),
      raw: (fn: (t: typeof tx) => unknown) => Promise.resolve().then(() => fn(tx)),
    }),
  };
});
vi.mock("@/lib/deposit-status-events", () => ({ recordDepositStatusEvent: vi.fn() }));
vi.mock("@/lib/refund", () => ({ refundAppointmentDeposits: vi.fn() }));
vi.mock("@/lib/salon-cancellation", () => ({
  buildSalonCancellationSms: vi.fn(),
  cancelAppointmentInTx: (...a: unknown[]) => h.cancelInTx(...a),
  expireCheckoutSessions: vi.fn(),
}));
vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

import { DELETE, PUT } from "@/app/api/appointments/[id]/route";
import { NO_SHOW_DEDICATED_ROUTE_CODE } from "@/lib/no-show";

const AUTH = { session: { id: "s-1" }, user: { id: "u-owner" } };
const OWNER_CTX = { salonId: SALON, userId: "u-owner", role: "owner", employeeId: null };
const EMPLOYEE_CTX = { salonId: SALON, userId: "u-emp", role: "employee", employeeId: EMPLOYEE };

type Err = { success: false; error: string; code?: string };

function put(body: unknown) {
  return PUT(
    createMockRequest(`http://localhost:3000/api/appointments/${APPOINTMENT}`, { method: "PUT", body }),
    createRouteParams(APPOINTMENT)
  );
}

function del() {
  return DELETE(
    new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}`, { method: "DELETE" }),
    createRouteParams(APPOINTMENT)
  );
}

function givenExisting(status: string) {
  h.findOne.mockResolvedValue(
    makeAppointment({
      id: APPOINTMENT,
      salonId: SALON,
      employeeId: EMPLOYEE,
      clientId: TEST_IDS.CLIENT_UUID,
      status,
    })
  );
}

function expectNothingWritten() {
  expect(h.update).not.toHaveBeenCalled();
  expect(h.set).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectRows = [];
  h.auth.mockResolvedValue(AUTH);
  h.salonCtx.mockResolvedValue(OWNER_CTX);
  h.refs.mockResolvedValue(null);
  givenExisting("scheduled");
  h.updated = [makeAppointment({ id: APPOINTMENT, salonId: SALON })];
});

describe("PUT /api/appointments/[id] — status „Nie przyszedł” tylko przez osobną trasę", () => {
  it("właściciel, status no_show → 400 NO_SHOW_DEDICATED_ROUTE, nic nie zapisane", async () => {
    const { status, body } = await parseResponse<Err>(await put({ status: "no_show" }));

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe(NO_SHOW_DEDICATED_ROUTE_CODE);
    expectNothingWritten();
  });

  it("pracownik na własnej wizycie, status no_show → 400, nic nie zapisane", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status, body } = await parseResponse<Err>(await put({ status: "no_show" }));

    expect(status).toBe(400);
    expect(body.code).toBe(NO_SHOW_DEDICATED_ROUTE_CODE);
    expectNothingWritten();
  });

  it.each(["scheduled", "confirmed", "completed", "cancelled"])(
    "wizyta oznaczona, zmiana statusu na %s → 400, nic nie zapisane",
    async (next) => {
      givenExisting("no_show");

      const { status, body } = await parseResponse<Err>(await put({ status: next }));

      expect(status).toBe(400);
      expect(body.code).toBe(NO_SHOW_DEDICATED_ROUTE_CODE);
      expectNothingWritten();
    }
  );

  it("wizyta oznaczona, sama notatka → 200 (edycja bez statusu działa)", async () => {
    givenExisting("no_show");

    const res = await put({ notes: "Dzwoniła po fakcie" });

    expect(res.status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ notes: "Dzwoniła po fakcie" });
  });

  it("kontrola: zwykła zmiana statusu (scheduled → confirmed) → 200 jak dotąd", async () => {
    const res = await put({ status: "confirmed" });

    expect(res.status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ status: "confirmed" });
  });

  it("obca wizyta ze statusem no_show → 404, nie 400 (strażnik po odczycie wizyty)", async () => {
    h.findOne.mockResolvedValue(null);

    const res = await put({ status: "no_show" });

    expect(res.status).toBe(404);
    expectNothingWritten();
  });
});

describe("DELETE /api/appointments/[id] — anulowanie wizyty oznaczonej", () => {
  it("wizyta no_show → 400 NO_SHOW_DEDICATED_ROUTE, bez anulowania", async () => {
    h.selectRows = [
      {
        appointment: makeAppointment({ id: APPOINTMENT, salonId: SALON, employeeId: EMPLOYEE, status: "no_show" }),
        client: null,
        employee: null,
        service: null,
      },
    ];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(400);
    expect(body.code).toBe(NO_SHOW_DEDICATED_ROUTE_CODE);
    expect(body.error).toMatch(/Najpierw cofnij/);
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });
});

/**
 * PUT i DELETE /api/appointments/[id] — wizytę zamyka tylko
 * POST /api/appointments/[id]/complete, a wizyta zakończona ma ostateczny wynik.
 *
 * - PUT ze statusem `completed` → 400 `COMPLETE_DEDICATED_ROUTE` z polskim
 *   komunikatem, nic nie zapisane (także pracownik na własnej wizycie).
 * - PUT zmieniający status wizyty zakończonej → 409 `APPOINTMENT_COMPLETED`,
 *   nic nie zapisane. Edycja notatki przy wizycie zakończonej działa.
 * - Zmiana statusu ma w UPDATE warunek `status <> 'completed'`; zakończenie
 *   wstawione między odczytem a zapisem (UPDATE bez wiersza, ponowny odczyt
 *   widzi `completed`) → ten sam 409.
 * - DELETE (anulowanie przez salon) wizyty zakończonej → 409 przed transakcją
 *   i po blokadzie wiersza (`AppointmentCompletedError` z `cancelAppointmentInTx`),
 *   bez wygaszania sesji, SMS-a i listy oczekujących.
 *
 * Atrapą jest baza (forSalon), sesja i kontekst salonu.
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
  /** Kolejne wyniki tx.select (PUT: kolizje, ponowny odczyt statusu; DELETE: odczyt wizyty). */
  selectResults: [] as unknown[][],
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  updated: [] as Record<string, unknown>[],
  transactions: 0,
  cancelInTx: vi.fn(),
  buildSms: vi.fn(),
  expireSessions: vi.fn(),
  notifyWaitingList: vi.fn(),
  refund: vi.fn(),
  NoShowError: class AppointmentMarkedNoShowError extends Error {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, ne: vi.fn(actual.ne) };
});
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
    chain.then = (resolve: (v: unknown) => unknown) => resolve(h.selectResults.shift() ?? []);
    return chain;
  };
  const update = (table: unknown) => {
    h.update(table);
    const chain: Record<string, unknown> = {};
    chain.set = (data: unknown) => {
      h.set(data);
      return chain;
    };
    chain.where = (w: unknown) => {
      h.updateWhere(w);
      return chain;
    };
    chain.returning = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(h.updated);
    return chain;
  };
  const tx = { select, update };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      findOne: (...a: unknown[]) => h.findOne(...a),
      raw: (fn: (t: typeof tx) => unknown) => {
        h.transactions++;
        return Promise.resolve().then(() => fn(tx));
      },
    }),
  };
});
vi.mock("@/lib/deposit-status-events", () => ({ recordDepositStatusEvent: vi.fn() }));
vi.mock("@/lib/refund", () => ({ refundAppointmentDeposits: (...a: unknown[]) => h.refund(...a) }));
vi.mock("@/lib/salon-cancellation", () => ({
  AppointmentMarkedNoShowError: h.NoShowError,
  buildSalonCancellationSms: (...a: unknown[]) => h.buildSms(...a),
  cancelAppointmentInTx: (...a: unknown[]) => h.cancelInTx(...a),
  expireCheckoutSessions: (...a: unknown[]) => h.expireSessions(...a),
}));
vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: (...a: unknown[]) => h.notifyWaitingList(...a) }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

import { ne } from "drizzle-orm";
import { DELETE, PUT } from "@/app/api/appointments/[id]/route";
import {
  APPOINTMENT_COMPLETED_CODE,
  APPOINTMENT_COMPLETED_MESSAGE,
  AppointmentCompletedError,
  COMPLETE_DEDICATED_ROUTE_CODE,
} from "@/lib/appointment-completion";
import { NO_SHOW_DEDICATED_ROUTE_CODE } from "@/lib/no-show";
import { appointments } from "@/lib/schema";

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

function givenDeleteRow(status: string) {
  h.selectResults = [
    [
      {
        appointment: makeAppointment({ id: APPOINTMENT, salonId: SALON, employeeId: EMPLOYEE, status }),
        client: null,
        employee: null,
        service: null,
      },
    ],
  ];
}

function expectNothingWritten() {
  expect(h.update).not.toHaveBeenCalled();
  expect(h.set).not.toHaveBeenCalled();
  expect(h.transactions).toBe(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults = [];
  h.transactions = 0;
  h.auth.mockResolvedValue(AUTH);
  h.salonCtx.mockResolvedValue(OWNER_CTX);
  h.refs.mockResolvedValue(null);
  givenExisting("scheduled");
  h.updated = [makeAppointment({ id: APPOINTMENT, salonId: SALON })];
});

describe("PUT /api/appointments/[id] — status `completed` tylko przez /complete", () => {
  it.each(["scheduled", "confirmed", "cancelled"])(
    "wizyta %s, status completed → 400 COMPLETE_DEDICATED_ROUTE z polskim komunikatem, nic nie zapisane",
    async (current) => {
      givenExisting(current);

      const { status, body } = await parseResponse<Err>(await put({ status: "completed" }));

      expect(status).toBe(400);
      expect(body).toEqual({
        success: false,
        code: COMPLETE_DEDICATED_ROUTE_CODE,
        error: "Wizytę zakończ przyciskiem Zakończ wizytę",
      });
      expectNothingWritten();
    }
  );

  it("pracownik na własnej wizycie, status completed → 400, nic nie zapisane", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status, body } = await parseResponse<Err>(await put({ status: "completed" }));

    expect(status).toBe(400);
    expect(body.code).toBe(COMPLETE_DEDICATED_ROUTE_CODE);
    expectNothingWritten();
  });

  it("status completed razem z innymi polami → 400, żadne pole nie zapisane", async () => {
    const { status } = await parseResponse<Err>(await put({ status: "completed", notes: "Zrobione" }));

    expect(status).toBe(400);
    expectNothingWritten();
  });

  it("wizyta zakończona, status completed → ten sam 400 (bez zapisu)", async () => {
    givenExisting("completed");

    const { status, body } = await parseResponse<Err>(await put({ status: "completed" }));

    expect(status).toBe(400);
    expect(body.code).toBe(COMPLETE_DEDICATED_ROUTE_CODE);
    expectNothingWritten();
  });

  it("wizyta „Nie przyszedł”, status completed → nadal 400 NO_SHOW_DEDICATED_ROUTE (pierwszy strażnik)", async () => {
    givenExisting("no_show");

    const { status, body } = await parseResponse<Err>(await put({ status: "completed" }));

    expect(status).toBe(400);
    expect(body.code).toBe(NO_SHOW_DEDICATED_ROUTE_CODE);
    expectNothingWritten();
  });

  it("obca wizyta ze statusem completed → 404, nie 400", async () => {
    h.findOne.mockResolvedValue(null);

    const { status } = await parseResponse<Err>(await put({ status: "completed" }));

    expect(status).toBe(404);
    expectNothingWritten();
  });

  it("401 bez sesji — bez odczytu i zapisu", async () => {
    h.auth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await put({ status: "completed" });

    expect(res.status).toBe(401);
    expect(h.findOne).not.toHaveBeenCalled();
    expectNothingWritten();
  });
});

describe("PUT /api/appointments/[id] — wyjście ze statusu `completed` zakazane", () => {
  it.each(["scheduled", "confirmed", "cancelled"])(
    "wizyta zakończona, zmiana statusu na %s → 409 APPOINTMENT_COMPLETED, nic nie zapisane",
    async (next) => {
      givenExisting("completed");

      const { status, body } = await parseResponse<Err>(await put({ status: next }));

      expect(status).toBe(409);
      expect(body).toEqual({
        success: false,
        code: APPOINTMENT_COMPLETED_CODE,
        error: APPOINTMENT_COMPLETED_MESSAGE,
      });
      expectNothingWritten();
    }
  );

  it("wizyta zakończona, sama notatka → 200 (edycja bez statusu działa, UPDATE bez warunku statusu)", async () => {
    givenExisting("completed");

    const res = await put({ notes: "Klientka zadowolona" });

    expect(res.status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ notes: "Klientka zadowolona" });
    expect(vi.mocked(ne)).not.toHaveBeenCalled();
  });

  it("zmiana statusu: UPDATE ma warunek status <> completed", async () => {
    const res = await put({ status: "confirmed" });

    expect(res.status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ status: "confirmed" });
    expect(vi.mocked(ne)).toHaveBeenCalledWith(appointments.status, "completed");
  });

  it("zakończenie weszło między odczytem a zapisem → 409, ponowny odczyt w tej samej transakcji, bez logu error", async () => {
    // 1) kolizje (brak), 2) ponowny odczyt statusu po UPDATE bez wiersza.
    h.selectResults = [[], [{ status: "completed" }]];
    h.updated = [];

    const { status, body } = await parseResponse<Err>(await put({ status: "cancelled" }));

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    expect(h.transactions).toBe(1);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("UPDATE bez wiersza, a wizyta nie jest zakończona (zniknęła) → odpowiedź jak dotąd, bez 409", async () => {
    h.selectResults = [[], []];
    h.updated = [];

    const res = await put({ status: "confirmed" });

    expect(res.status).toBe(200);
  });

  it("500 przy błędzie bazy w transakcji (nie mylony z 409)", async () => {
    h.update.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await put({ status: "confirmed" });

    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/appointments/[id] — anulowanie wizyty zakończonej", () => {
  it("wizyta completed przy odczycie → 409, bez transakcji anulowania", async () => {
    givenDeleteRow("completed");

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(409);
    expect(body).toEqual({
      success: false,
      code: APPOINTMENT_COMPLETED_CODE,
      error: APPOINTMENT_COMPLETED_MESSAGE,
    });
    expect(h.cancelInTx).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("zakończenie weszło po odczycie (completed po blokadzie wiersza) → 409, bez skutków anulowania", async () => {
    givenDeleteRow("scheduled");
    h.cancelInTx.mockRejectedValue(new AppointmentCompletedError());

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    expect(h.cancelInTx).toHaveBeenCalledWith(expect.anything(), SALON, APPOINTMENT);
    expect(h.expireSessions).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.buildSms).not.toHaveBeenCalled();
    expect(h.notifyWaitingList).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });
});

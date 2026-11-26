/**
 * PUT /api/appointments/[id] przy wyłączonym zadatku — stan dzisiejszej produkcji.
 *
 * `isDepositEnabled()` (rejestr PRAWDZIWY, bez atrapy) zwraca false. Kwota
 * zadatku większa od 0 dałaby klientowi w portalu zadatek „oczekujący”, którego
 * nie ma jak wpłacić — trasa odpowiada 409 `DEPOSITS_DISABLED` i niczego nie
 * zapisuje. null i zero przechodzą (czyszczenie starych wierszy), brak pola
 * też. Atrapą jest baza (forSalon), sesja i kontekst salonu.
 *
 * Kody: 200 (null, "0", "0.00", brak pola), 400 (zły identyfikator, walidacja),
 * 401 (bez sesji), 403 (pracownik, recepcja), 404 (brak salonu, brak wizyty),
 * 409 (kwota dodatnia), 500 (błąd bazy).
 */
import { NextResponse } from "next/server";
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
  /** Wynik każdego tx.select (kolizje, blokady): domyślnie pusto. */
  selectRows: [] as Record<string, unknown>[],
  update: vi.fn(),
  set: vi.fn(),
  updated: [] as Record<string, unknown>[],
  recordEvent: vi.fn(),
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
vi.mock("@/lib/deposit-status-events", () => ({
  recordDepositStatusEvent: (...a: unknown[]) => h.recordEvent(...a),
}));
vi.mock("@/lib/refund", () => ({ refundAppointmentDeposits: vi.fn() }));
vi.mock("@/lib/salon-cancellation", () => ({
  buildSalonCancellationSms: vi.fn(),
  cancelAppointmentInTx: vi.fn(),
  expireCheckoutSessions: vi.fn(),
}));
vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

import { PUT } from "@/app/api/appointments/[id]/route";
import { DEPOSITS_DISABLED_CODE, DEPOSITS_DISABLED_MESSAGE, isDepositEnabled } from "@/lib/features";
import { appointments } from "@/lib/schema";

const AUTH = { session: { id: "s-1" }, user: { id: "u-owner" } };
const OWNER_CTX = { salonId: SALON, userId: "u-owner", role: "owner", employeeId: null };

type Err = { success: false; error: string; code?: string };
type Ok = { success: true; data: Record<string, unknown> };

function put(body: unknown, id: string = APPOINTMENT) {
  return PUT(
    createMockRequest(`http://localhost:3000/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );
}

/** Pola zapisu przekazane do `.set(...)` (jedyny zapis tej trasy). */
function written(): Record<string, unknown> {
  return h.set.mock.calls[0]![0] as Record<string, unknown>;
}

function expectNothingWritten() {
  expect(h.update).not.toHaveBeenCalled();
  expect(h.set).not.toHaveBeenCalled();
  expect(h.recordEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectRows = [];
  h.auth.mockResolvedValue(AUTH);
  h.salonCtx.mockResolvedValue(OWNER_CTX);
  h.refs.mockResolvedValue(null);
  h.findOne.mockResolvedValue(
    makeAppointment({ id: APPOINTMENT, salonId: SALON, employeeId: EMPLOYEE, clientId: TEST_IDS.CLIENT_UUID })
  );
  h.updated = [makeAppointment({ id: APPOINTMENT, salonId: SALON })];
});

describe("PUT /api/appointments/[id] — zadatek wyłączony, kwota zadatku", () => {
  it("rejestr flag jest prawdziwy: isDepositEnabled() = false", () => {
    expect(isDepositEnabled()).toBe(false);
  });

  it.each([["50.00"], ["0.01"], ["1"], [" 50 "]])(
    "właściciel, depositAmount %j → 409 DEPOSITS_DISABLED, nic nie zapisane",
    async (amount) => {
      const { status, body } = await parseResponse<Err>(await put({ depositAmount: amount }));

      expect(status).toBe(409);
      expect(body).toEqual({ success: false, code: DEPOSITS_DISABLED_CODE, error: DEPOSITS_DISABLED_MESSAGE });
      expectNothingWritten();
    }
  );

  it("kwota dodatnia razem z innymi polami (notatka, depositPaid) → 409, nic nie zapisane", async () => {
    const res = await put({ depositAmount: "30.00", depositPaid: true, notes: "Zadatek ręcznie" });

    expect(res.status).toBe(409);
    expectNothingWritten();
  });

  it("napis, który nie jest liczbą (\"NaN\", \"abc\") → 409, nic nie zapisane", async () => {
    for (const amount of ["NaN", "abc"]) {
      const res = await put({ depositAmount: amount });
      expect(res.status).toBe(409);
    }
    expectNothingWritten();
  });

  it("depositAmount null → 200, kwota wyczyszczona w zapisie", async () => {
    const { status, body } = await parseResponse<Ok>(await put({ depositAmount: null }));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.update).toHaveBeenCalledWith(appointments);
    expect(written()).toEqual({ depositAmount: null });
  });

  it.each([["0"], ["0.00"]])("depositAmount %j → 200, zapis bez zmian w zachowaniu", async (amount) => {
    const res = await put({ depositAmount: amount });

    expect(res.status).toBe(200);
    expect(written()).toEqual({ depositAmount: amount });
  });

  it("brak pola depositAmount (sama notatka) → 200, zapis bez kwoty zadatku", async () => {
    const res = await put({ notes: "Nowa notatka" });

    expect(res.status).toBe(200);
    expect(written()).toEqual({ notes: "Nowa notatka" });
    expect(written()).not.toHaveProperty("depositAmount");
  });

  it("pracownik zmienia samą notatkę na własnej wizycie → 200 (bramka nie dotyczy)", async () => {
    h.salonCtx.mockResolvedValue({ salonId: SALON, userId: "u-emp", role: "employee", employeeId: EMPLOYEE });

    const res = await put({ notes: "Notatka pracownika" });

    expect(res.status).toBe(200);
  });

  it("liczba 0 zamiast napisu → 400 walidacji (schemat przyjmuje napis), nie 409", async () => {
    const { status, body } = await parseResponse<{ success: false; error: string; details: Record<string, string> }>(
      await put({ depositAmount: 0 })
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(Object.keys(body.details)).toContain("depositAmount");
    expectNothingWritten();
  });
});

describe("PUT /api/appointments/[id] — zadatek wyłączony, kolejność odpowiedzi", () => {
  it("bez sesji → 401 przed bramką zadatku, bez odczytu wizyty", async () => {
    h.auth.mockResolvedValue(NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 }));

    const res = await put({ depositAmount: "50.00" });

    expect(res.status).toBe(401);
    expect(h.salonCtx).not.toHaveBeenCalled();
    expect(h.findOne).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each([
    ["pracownik", { salonId: SALON, userId: "u-emp", role: "employee", employeeId: EMPLOYEE }],
    ["recepcja", { salonId: SALON, userId: "u-rec", role: "receptionist", employeeId: null }],
  ])("%s z kwotą zadatku → 403 (bramka roli przed bramką zadatku)", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);

    const { status, body } = await parseResponse<Err>(await put({ depositAmount: "50.00" }));

    expect(status).toBe(403);
    expect(body.code).toBeUndefined();
    expect(h.findOne).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("pracownik z depositAmount null → 403, jak dotąd", async () => {
    h.salonCtx.mockResolvedValue({ salonId: SALON, userId: "u-emp", role: "employee", employeeId: EMPLOYEE });

    const res = await put({ depositAmount: null });

    expect(res.status).toBe(403);
    expectNothingWritten();
  });

  it("brak salonu w kontekście → 404", async () => {
    h.salonCtx.mockResolvedValue(null);

    const res = await put({ depositAmount: "50.00" });

    expect(res.status).toBe(404);
    expectNothingWritten();
  });

  it("wizyta nie istnieje (albo cudza) z kwotą zadatku → 404, nie 409", async () => {
    h.findOne.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await put({ depositAmount: "50.00" }));

    expect(status).toBe(404);
    expect(body.error).toBe("Appointment not found");
    expectNothingWritten();
  });

  it("zły identyfikator wizyty → 400, bez odczytu", async () => {
    const res = await put({ depositAmount: "50.00" }, "nie-uuid");

    expect(res.status).toBe(400);
    expect(h.findOne).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("błąd walidacji (zły status) razem z kwotą → 400, nie 409", async () => {
    const res = await put({ depositAmount: "50.00", status: "nieznany" });

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it("obcy pracownik w body (assertSalonRefs) z kwotą → 400 z refów, nie 409", async () => {
    h.refs.mockResolvedValue(
      NextResponse.json({ success: false, error: "Nieprawidlowe dane dla tego salonu" }, { status: 400 })
    );

    const res = await put({ depositAmount: "50.00", employeeId: "99999999-9999-4999-8999-999999999999" });

    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it("błąd bazy przy odczycie wizyty → 500, nic nie zapisane", async () => {
    h.findOne.mockRejectedValue(new Error("connection terminated"));

    const { status, body } = await parseResponse<Err>(await put({ depositAmount: null }));

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to update appointment");
    expectNothingWritten();
  });

  it("błąd bazy przy zapisie (depositAmount null) → 500", async () => {
    h.update.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await put({ depositAmount: null });

    expect(res.status).toBe(500);
    expect(h.set).not.toHaveBeenCalled();
  });
});

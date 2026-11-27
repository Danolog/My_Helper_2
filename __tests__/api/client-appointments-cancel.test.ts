/**
 * GET/POST /api/client/appointments/[id]/cancel (#193, ADR-002).
 *
 * - Wizyta z odczytu systemowego `findClientAppointmentForUser(sesja, id)`;
 *   odczyt płatności i zapis anulowania przez `forSalon(salon z wyniku odczytu)`.
 *   Surowe `db` nie jest używane (atrapa rzuca przy dostępie).
 * - Zapis ponawia warunki: id, salon, tożsamość z sesji i stan (bez
 *   `cancelled`/`completed`/`no_show`); jawne kolumny w `returning`.
 * - Wizyta „Nie przyszedł” (także jeszcze w przyszłości) → 400 bez zapisu.
 * - 0 wierszy z zapisu = 404, bez zwrotu, zatrzymania zadatku i powiadomień.
 * - Zadatek wpłacony bez płatności `succeeded` w MyHelper (np. BLIK na telefon
 *   salonu oznaczony ręcznie) nie daje obietnicy zwrotu ani przepadku.
 * - Dokładny zbiór kluczy odpowiedzi (także zagnieżdżonych).
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/client/appointments/[id]/cancel/route";
import { createMockRequest, parseResponse } from "./helpers";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
  find: vi.fn(),
  selectSucceededInTx: vi.fn(),
  refundDeposits: vi.fn(),
  notifyWaitingList: vi.fn(),
  forSalon: vi.fn(),
  update: {
    calls: 0,
    set: null as unknown,
    where: null as unknown,
    returning: null as Record<string, unknown> | null,
    rows: [] as unknown[],
    error: null as Error | null,
  },
  tx: { marker: "tx" } as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    throw new Error("surowe db nie może być użyte w trasie anulowania przez klienta (#193)");
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => m.requireAuth(...a),
  isAuthError: (...a: unknown[]) => m.isAuthError(...a),
}));

vi.mock("@/lib/server/system", () => ({
  findClientAppointmentForUser: (...a: unknown[]) => m.find(...a),
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => {
    m.forSalon(salonId);
    return { salonId, raw: (fn: (tx: unknown) => Promise<unknown>) => fn(m.tx) };
  },
}));

vi.mock("@/lib/refund", () => ({
  selectSucceededDepositsInTx: (...a: unknown[]) => m.selectSucceededInTx(...a),
  refundAppointmentDeposits: (...a: unknown[]) => m.refundDeposits(...a),
}));

vi.mock("@/lib/waiting-list", () => ({
  notifyWaitingList: (...a: unknown[]) => m.notifyWaitingList(...a),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return { appointments: table("appointments") };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  notInArray: (col: unknown, val: unknown) => ({ op: "notInArray", col, val }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const APPOINTMENT_ID = "3f0c2a8e-6b1d-4c3e-9a7f-2d5e8b1c4a90";
const SALON_ID = "salon-a";
const USER_ID = "client-user";
const HOUR = 60 * 60 * 1000;
const SALON_PHONE = "+48 600 100 200";
const NO_SHOW_CANCEL_ERROR = "Tej wizyty nie można już anulować. Skontaktuj się z salonem.";

function installTx() {
  const u = m.update;
  const chain: Record<string, unknown> = {};
  chain.set = (v: unknown) => {
    u.set = v;
    return chain;
  };
  chain.where = (w: unknown) => {
    u.where = w;
    return chain;
  };
  chain.returning = (cols: Record<string, unknown>) => {
    u.returning = cols;
    return chain;
  };
  chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
    u.error ? reject(u.error) : resolve(u.rows);
  m.tx.update = (table: unknown) => {
    u.calls++;
    expect(table).toBeDefined();
    return chain;
  };
}

function found(opts: {
  hoursAhead: number;
  depositAmount?: string | null;
  depositPaid?: boolean;
  status?: string;
  salonPhone?: string | null;
  noJoins?: boolean;
}) {
  const start = new Date(Date.now() + opts.hoursAhead * HOUR);
  return {
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    serviceId: "service-1",
    employeeId: "employee-1",
    status: opts.status ?? "scheduled",
    startTime: start,
    endTime: new Date(start.getTime() + HOUR),
    depositAmount: opts.depositAmount === undefined ? "50.00" : opts.depositAmount,
    depositPaid: opts.depositPaid ?? true,
    salonName: opts.noJoins ? null : "Salon Test",
    salonPhone: opts.noJoins ? null : opts.salonPhone === undefined ? SALON_PHONE : opts.salonPhone,
    serviceName: opts.noJoins ? null : "Strzyzenie",
    servicePrice: opts.noJoins ? null : "100.00",
    employeeName: opts.noJoins ? null : "Ola Nowak",
  };
}

function cancelledRow(f: ReturnType<typeof found>) {
  return { id: f.appointmentId, status: "cancelled", startTime: f.startTime, endTime: f.endTime };
}

const SUCCEEDED_PAYMENT = { id: "dp-1", status: "succeeded", amount: "50.00" };

type Body = {
  success: boolean;
  error?: string;
  message?: string;
  data: Record<string, unknown> & { deposit: Record<string, unknown>; salon: unknown };
  cancellationDetails: Record<string, unknown>;
};

function ctx(id = APPOINTMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

async function get(id = APPOINTMENT_ID) {
  const req = createMockRequest(`http://localhost:3000/api/client/appointments/${id}/cancel`);
  return parseResponse<Body>(await GET(req, ctx(id)));
}

async function post(id = APPOINTMENT_ID) {
  const req = createMockRequest(`http://localhost:3000/api/client/appointments/${id}/cancel`, { method: "POST" });
  return parseResponse<Body>(await POST(req, ctx(id)));
}

/** Ustawia wynik odczytu i — dla POST — wiersz zwrócony przez zapis. */
function given(f: ReturnType<typeof found> | null) {
  m.find.mockResolvedValue(f);
  m.update.rows = f ? [cancelledRow(f)] : [];
}

const GET_DATA_KEYS = [
  "appointmentId",
  "canCancel",
  "deposit",
  "employee",
  "endTime",
  "hoursUntilAppointment",
  "isMoreThan24h",
  "isPast",
  "salon",
  "service",
  "startTime",
  "status",
];
const POST_KEYS = ["cancellationDetails", "data", "message", "success"];
const POST_DATA_KEYS = ["endTime", "id", "startTime", "status"];
const DETAILS_KEYS = [
  "depositAmount",
  "depositForfeited",
  "depositPaid",
  "depositRefunded",
  "depositSettledBySalon",
  "hasDeposit",
  "hoursUntilAppointment",
  "isMoreThan24h",
  "refund",
];

beforeEach(() => {
  vi.clearAllMocks();
  m.update.calls = 0;
  m.update.set = null;
  m.update.where = null;
  m.update.returning = null;
  m.update.rows = [];
  m.update.error = null;
  installTx();
  m.requireAuth.mockResolvedValue({ user: { id: USER_ID }, session: { user: { id: USER_ID } } });
  m.isAuthError.mockReturnValue(false);
  m.find.mockResolvedValue(null);
  m.selectSucceededInTx.mockResolvedValue([]);
  m.refundDeposits.mockResolvedValue({
    success: true,
    refunded: true,
    refundId: "re_1",
    amount: 50,
    message: "Zwrot zadatku 50.00 PLN zostal zainicjowany",
    paymentCount: 1,
    results: [],
  });
  m.notifyWaitingList.mockResolvedValue({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
});

describe("GET /api/client/appointments/[id]/cancel", () => {
  it("odczyt wizyty z tożsamością z sesji i id z adresu", async () => {
    given(found({ hoursAhead: 48 }));
    await get();
    expect(m.find).toHaveBeenCalledWith(USER_ID, APPOINTMENT_ID);
  });

  it("200: płatność succeeded, >24 h → refund; odczyt płatności w salonie wizyty", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "refund", settledBySalon: false });
    expect(m.forSalon).toHaveBeenCalledWith(SALON_ID);
    expect(m.selectSucceededInTx).toHaveBeenCalledWith(m.tx, SALON_ID, APPOINTMENT_ID);
  });

  it("200: płatność succeeded, <24 h → forfeit", async () => {
    given(found({ hoursAhead: 5 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { body } = await get();
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "forfeit", settledBySalon: false });
  });

  it.each([
    [">24 h", 48],
    ["<24 h", 5],
  ])("200: wpłacony bez płatności succeeded (%s) → salon z telefonem", async (_label, hoursAhead) => {
    given(found({ hoursAhead }));
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "salon", settledBySalon: true });
    expect(body.data.salon).toEqual({ name: "Salon Test", phone: SALON_PHONE });
  });

  it("200: salon bez telefonu → phone null", async () => {
    given(found({ hoursAhead: 48, salonPhone: null }));
    const { body } = await get();
    expect(body.data.salon).toEqual({ name: "Salon Test", phone: null });
  });

  it("200: dokładny zbiór kluczy odpowiedzi (także zagnieżdżonych)", async () => {
    given(found({ hoursAhead: 48 }));
    const { body } = await get();
    expect(Object.keys(body).sort()).toEqual(["data", "success"]);
    expect(Object.keys(body.data).sort()).toEqual(GET_DATA_KEYS);
    expect(Object.keys(body.data.deposit).sort()).toEqual(["action", "amount", "paid", "settledBySalon"]);
    expect(body.data.employee).toEqual({ name: "Ola Nowak" });
    expect(body.data.service).toEqual({ name: "Strzyzenie", price: "100.00" });
    expect(Object.keys(body.data.salon as object).sort()).toEqual(["name", "phone"]);
  });

  it("200: brak pracownika, usługi i salonu w łączeniu → null", async () => {
    given(found({ hoursAhead: 48, noJoins: true }));
    const { body } = await get();
    expect(body.data.employee).toBeNull();
    expect(body.data.service).toBeNull();
    expect(body.data.salon).toBeNull();
  });

  it.each([
    ["bez zadatku (null)", { depositAmount: null }],
    ["zadatek 0", { depositAmount: "0.00" }],
    ["niewpłacony", { depositPaid: false }],
  ])("200: %s → none, bez odczytu płatności", async (_label, opts) => {
    given(found({ hoursAhead: 48, ...opts }));
    const { body } = await get();
    expect(body.data.deposit.action).toBe("none");
    expect(body.data.deposit.settledBySalon).toBe(false);
    expect(m.selectSucceededInTx).not.toHaveBeenCalled();
  });

  it("GET nie zapisuje", async () => {
    given(found({ hoursAhead: 48 }));
    await get();
    expect(m.update.calls).toBe(0);
  });

  it("400: zły UUID, bez odczytu", async () => {
    const { status } = await get("not-a-uuid");
    expect(status).toBe(400);
    expect(m.find).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "completed"])("400: wizyta %s, bez odczytu płatności", async (appointmentStatus) => {
    given(found({ hoursAhead: 48, status: appointmentStatus }));
    const { status } = await get();
    expect(status).toBe(400);
    expect(m.selectSucceededInTx).not.toHaveBeenCalled();
  });

  it("400: wizyta „Nie przyszedł” w przyszłości, bez odczytu płatności", async () => {
    given(found({ hoursAhead: 6, status: "no_show" }));
    const { status, body } = await get();
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: NO_SHOW_CANCEL_ERROR });
    expect(m.selectSucceededInTx).not.toHaveBeenCalled();
  });

  it("401: brak sesji", async () => {
    m.requireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    m.isAuthError.mockReturnValue(true);
    const { status } = await get();
    expect(status).toBe(401);
    expect(m.find).not.toHaveBeenCalled();
  });

  it("404: cudza lub nieistniejąca wizyta (bez rozróżnienia)", async () => {
    given(null);
    const { status, body } = await get();
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Appointment not found" });
    expect(m.forSalon).not.toHaveBeenCalled();
  });

  it("500: błąd odczytu wizyty", async () => {
    m.find.mockRejectedValue(new Error("db down"));
    const { status } = await get();
    expect(status).toBe(500);
  });

  it("500: błąd odczytu płatności zadatku", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockRejectedValue(new Error("db down"));
    const { status } = await get();
    expect(status).toBe(500);
  });
});

describe("POST /api/client/appointments/[id]/cancel", () => {
  it("zapis w salonie wizyty z ponowionymi warunkami id, salonu, tożsamości i stanu; jawne returning", async () => {
    given(found({ hoursAhead: 48, depositAmount: null, depositPaid: false }));
    const { status } = await post();
    expect(status).toBe(200);
    expect(m.forSalon).toHaveBeenCalledWith(SALON_ID);
    expect(m.update.set).toEqual({ status: "cancelled" });
    expect(m.update.where).toEqual({
      op: "and",
      args: [
        { op: "eq", col: "appointments.id", val: APPOINTMENT_ID },
        { op: "eq", col: "appointments.salonId", val: SALON_ID },
        { op: "eq", col: "appointments.bookedByUserId", val: USER_ID },
        { op: "notInArray", col: "appointments.status", val: ["cancelled", "completed", "no_show"] },
      ],
    });
    expect(m.update.returning).toEqual({
      id: "appointments.id",
      status: "appointments.status",
      startTime: "appointments.startTime",
      endTime: "appointments.endTime",
    });
  });

  it("200: dokładny zbiór kluczy odpowiedzi (także zagnieżdżonych)", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { body } = await post();
    expect(Object.keys(body).sort()).toEqual(POST_KEYS);
    expect(Object.keys(body.data).sort()).toEqual(POST_DATA_KEYS);
    expect(Object.keys(body.cancellationDetails).sort()).toEqual(DETAILS_KEYS);
    // Bez identyfikatora zwrotu (id Stripe albo wewnętrzne id płatności, ADR-002 §2.5).
    expect(Object.keys(body.cancellationDetails.refund as object).sort()).toEqual([
      "amount",
      "message",
      "processed",
    ]);
    expect(body.cancellationDetails.refund).not.toHaveProperty("refundId");
    expect(JSON.stringify(body)).not.toContain("re_1");
    expect(body.data.status).toBe("cancelled");
  });

  it.each([
    [">24 h", 48],
    ["<24 h", 5],
  ])("bez płatności succeeded (%s): rozlicza salon, bez zwrotu/zatrzymania", async (_l, hoursAhead) => {
    given(found({ hoursAhead }));
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body.message).toBe("Wizyta zostala anulowana");
    expect(body.cancellationDetails).toMatchObject({
      depositPaid: true,
      depositAmount: 50,
      depositRefunded: false,
      depositForfeited: false,
      depositSettledBySalon: true,
      refund: null,
    });
    expect(m.refundDeposits).not.toHaveBeenCalled();
    expect(m.update.calls).toBe(1);
  });

  it("z płatnością succeeded, >24 h: zwrot po zapisie", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body.cancellationDetails).toMatchObject({
      depositRefunded: true,
      depositForfeited: false,
      depositSettledBySalon: false,
      refund: { processed: true, amount: 50 },
    });
    expect(body.cancellationDetails.refund).not.toHaveProperty("refundId");
    expect(m.refundDeposits).toHaveBeenCalledTimes(1);
    expect(m.refundDeposits).toHaveBeenCalledWith(APPOINTMENT_ID, expect.any(String));
  });

  it("z płatnością succeeded, <24 h: zatrzymanie", async () => {
    given(found({ hoursAhead: 5 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    m.refundDeposits.mockResolvedValue({
      success: true,
      refunded: false,
      message: "Zadatek zatrzymany przez salon",
      paymentCount: 1,
      forfeitedPaymentId: "dp-1",
      results: [],
    });
    const { body } = await post();
    expect(body.cancellationDetails).toMatchObject({
      depositRefunded: false,
      depositForfeited: true,
      depositSettledBySalon: false,
      refund: null,
    });
    expect(m.refundDeposits).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      expect.any(String),
      expect.objectContaining({ forfeitReason: expect.any(String) })
    );
  });

  it("bez zadatku: nic do rozliczenia, bez odczytu płatności", async () => {
    given(found({ hoursAhead: 48, depositAmount: null, depositPaid: false }));
    const { body } = await post();
    expect(body.cancellationDetails).toMatchObject({
      depositRefunded: false,
      depositForfeited: false,
      depositSettledBySalon: false,
    });
    expect(m.selectSucceededInTx).not.toHaveBeenCalled();
    expect(m.refundDeposits).not.toHaveBeenCalled();
  });

  it("lista oczekujących: salon, usługa i pracownik z odczytu wizyty", async () => {
    const f = found({ hoursAhead: 48, depositAmount: null, depositPaid: false });
    given(f);
    await post();
    expect(m.notifyWaitingList).toHaveBeenCalledTimes(1);
    expect(m.notifyWaitingList).toHaveBeenCalledWith({
      salonId: SALON_ID,
      serviceId: "service-1",
      employeeId: "employee-1",
      startTime: f.startTime,
      endTime: f.endTime,
      serviceName: "Strzyzenie",
      employeeName: "Ola Nowak",
      salonName: "Salon Test",
    });
  });

  it("lista oczekujących: brak nazw z łączenia → wartości zastępcze", async () => {
    given(found({ hoursAhead: 48, depositAmount: null, depositPaid: false, noJoins: true }));
    await post();
    expect(m.notifyWaitingList).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "Wizyta", employeeName: "Pracownik", salonName: "Salon" })
    );
  });

  it("błąd listy oczekujących nie cofa anulowania (200)", async () => {
    given(found({ hoursAhead: 48, depositAmount: null, depositPaid: false }));
    m.notifyWaitingList.mockRejectedValue(new Error("boom"));
    const { status } = await post();
    expect(status).toBe(200);
  });

  it("zapis zwraca 0 wierszy (równoległe anulowanie, zmiana stanu): 404, bez zwrotu i bez powiadomień", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    m.update.rows = [];
    const { status, body } = await post();
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "Appointment not found" });
    expect(m.update.calls).toBe(1);
    expect(m.refundDeposits).not.toHaveBeenCalled();
    expect(m.notifyWaitingList).not.toHaveBeenCalled();
  });

  it("zapis zwraca 0 wierszy przy zadatku <24 h: bez zatrzymania", async () => {
    given(found({ hoursAhead: 5 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    m.update.rows = [];
    const { status } = await post();
    expect(status).toBe(404);
    expect(m.refundDeposits).not.toHaveBeenCalled();
  });

  it("400: wizyta już się rozpoczęła, bez zapisu", async () => {
    given(found({ hoursAhead: -1 }));
    const { status } = await post();
    expect(status).toBe(400);
    expect(m.update.calls).toBe(0);
  });

  it.each([
    ["cancelled", "Wizyta jest juz anulowana"],
    ["completed", "Nie mozna anulowac zakonczonej wizyty"],
  ])("400: wizyta %s, bez zapisu", async (appointmentStatus, error) => {
    given(found({ hoursAhead: 48, status: appointmentStatus }));
    const { status, body } = await post();
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error });
    expect(m.update.calls).toBe(0);
  });

  it("400: wizyta „Nie przyszedł” w przyszłości (oznaczona rano), bez zapisu i bez zwrotu", async () => {
    given(found({ hoursAhead: 6, status: "no_show" }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { status, body } = await post();
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: NO_SHOW_CANCEL_ERROR });
    // Komunikat dla klienta nie zdradza oznaczenia.
    expect(body.error).not.toMatch(/przyszed|no.?show/i);
    expect(m.update.calls).toBe(0);
    expect(m.refundDeposits).not.toHaveBeenCalled();
    expect(m.notifyWaitingList).not.toHaveBeenCalled();
  });

  it("400: zły UUID, bez odczytu i zapisu", async () => {
    const { status } = await post("not-a-uuid");
    expect(status).toBe(400);
    expect(m.find).not.toHaveBeenCalled();
    expect(m.update.calls).toBe(0);
  });

  it("401: brak sesji", async () => {
    m.requireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    m.isAuthError.mockReturnValue(true);
    const { status } = await post();
    expect(status).toBe(401);
    expect(m.update.calls).toBe(0);
  });

  it("404: cudza lub nieistniejąca wizyta, bez zapisu", async () => {
    given(null);
    const { status } = await post();
    expect(status).toBe(404);
    expect(m.update.calls).toBe(0);
    expect(m.forSalon).not.toHaveBeenCalled();
  });

  it("500: błąd odczytu płatności — wizyta nie zostaje anulowana", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockRejectedValue(new Error("db down"));
    const { status } = await post();
    expect(status).toBe(500);
    expect(m.update.calls).toBe(0);
    expect(m.refundDeposits).not.toHaveBeenCalled();
  });

  it("500: błąd zapisu — bez zwrotu i powiadomień", async () => {
    given(found({ hoursAhead: 48 }));
    m.selectSucceededInTx.mockResolvedValue([SUCCEEDED_PAYMENT]);
    m.update.error = new Error("db down");
    const { status } = await post();
    expect(status).toBe(500);
    expect(m.refundDeposits).not.toHaveBeenCalled();
    expect(m.notifyWaitingList).not.toHaveBeenCalled();
  });
});

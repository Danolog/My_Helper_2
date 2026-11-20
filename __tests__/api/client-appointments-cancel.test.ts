/**
 * GET/POST /api/client/appointments/[id]/cancel — zadatek wpłacony bez
 * płatności `succeeded` w MyHelper (np. BLIK na telefon salonu oznaczony
 * ręcznie) nie może dawać klientowi obietnicy zwrotu ani przepadku: aplikacja
 * nie wykona przelewu, zwrot ustala salon. Zadatek z płatnością `succeeded`
 * zachowuje dotychczasową politykę 24 h.
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/client/appointments/[id]/cancel/route";
import { createMockRequest, parseResponse } from "./helpers";

const { mockRequireAuth, mockIsAuthError, mockSelectSucceeded, mockRefundDeposits, mockNotifyWaitingList, mockUpdateSet } =
  vi.hoisted(() => ({
    mockRequireAuth: vi.fn(),
    mockIsAuthError: vi.fn(),
    mockSelectSucceeded: vi.fn(),
    mockRefundDeposits: vi.fn(),
    mockNotifyWaitingList: vi.fn(),
    mockUpdateSet: vi.fn(),
  }));

let selectQueue: unknown[][] = [];
let selectError: Error | null = null;

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "leftJoin", "where", "limit", "returning"]) c[m] = vi.fn(() => c);
  c.set = vi.fn((v: unknown) => {
    mockUpdateSet(v);
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
    if (selectError) return reject(selectError);
    return resolve(result());
  };
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => selectQueue.shift() ?? []),
    update: () => chain(() => [{ id: APPOINTMENT_ID, status: "cancelled" }]),
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: mockRequireAuth,
  isAuthError: mockIsAuthError,
}));

vi.mock("@/lib/refund", () => ({
  selectSucceededDeposits: mockSelectSucceeded,
  refundAppointmentDeposits: mockRefundDeposits,
}));

vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: mockNotifyWaitingList }));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return {
    appointments: table("appointments"),
    employees: table("employees"),
    services: table("services"),
    salons: table("salons"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const APPOINTMENT_ID = "3f0c2a8e-6b1d-4c3e-9a7f-2d5e8b1c4a90";
const HOUR = 60 * 60 * 1000;
const SALON_PHONE = "+48 600 100 200";

function row(opts: {
  hoursAhead: number;
  depositAmount?: string | null;
  depositPaid?: boolean;
  status?: string;
  salonPhone?: string | null;
}) {
  const start = new Date(Date.now() + opts.hoursAhead * HOUR);
  return {
    appointment: {
      id: APPOINTMENT_ID,
      salonId: "salon-1",
      serviceId: "service-1",
      employeeId: "employee-1",
      status: opts.status ?? "scheduled",
      startTime: start,
      endTime: new Date(start.getTime() + HOUR),
      depositAmount: opts.depositAmount === undefined ? "50.00" : opts.depositAmount,
      depositPaid: opts.depositPaid ?? true,
    },
    employee: { firstName: "Ola", lastName: "Nowak" },
    service: { name: "Strzyzenie", basePrice: "100.00" },
    salon: { name: "Salon Test", phone: opts.salonPhone === undefined ? SALON_PHONE : opts.salonPhone },
  };
}

const SUCCEEDED_PAYMENT = { id: "dp-1", status: "succeeded", amount: "50.00" };

type CancelBody = {
  success: boolean;
  message?: string;
  data: { deposit: Record<string, unknown>; salon: unknown };
  cancellationDetails: Record<string, unknown>;
};

function ctx(id = APPOINTMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

async function get(id = APPOINTMENT_ID) {
  const req = createMockRequest(`http://localhost:3000/api/client/appointments/${id}/cancel`);
  return parseResponse<CancelBody>(await GET(req, ctx(id)));
}

async function post(id = APPOINTMENT_ID) {
  const req = createMockRequest(`http://localhost:3000/api/client/appointments/${id}/cancel`, { method: "POST" });
  return parseResponse<CancelBody>(await POST(req, ctx(id)));
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  selectError = null;
  mockRequireAuth.mockResolvedValue({ user: { id: "client-user" }, session: { user: { id: "client-user" } } });
  mockIsAuthError.mockReturnValue(false);
  mockSelectSucceeded.mockResolvedValue([]);
  mockRefundDeposits.mockResolvedValue({
    success: true,
    refunded: true,
    refundId: "re_1",
    amount: 50,
    message: "Zwrot zadatku 50.00 PLN zostal zainicjowany",
    paymentCount: 1,
    results: [],
  });
  mockNotifyWaitingList.mockResolvedValue({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
});

describe("GET /api/client/appointments/[id]/cancel — zadatek", () => {
  it("200: płatność succeeded, >24 h → refund, settledBySalon false", async () => {
    selectQueue = [[row({ hoursAhead: 48 })]];
    mockSelectSucceeded.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "refund", settledBySalon: false });
    expect(mockSelectSucceeded).toHaveBeenCalledWith(APPOINTMENT_ID);
  });

  it("200: płatność succeeded, <24 h → forfeit, settledBySalon false", async () => {
    selectQueue = [[row({ hoursAhead: 5 })]];
    mockSelectSucceeded.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { body } = await get();
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "forfeit", settledBySalon: false });
  });

  it.each([
    [">24 h", 48],
    ["<24 h", 5],
  ])("200: wpłacony bez płatności succeeded (%s) → salon z telefonem", async (_label, hoursAhead) => {
    selectQueue = [[row({ hoursAhead })]];
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.data.deposit).toEqual({ amount: 50, paid: true, action: "salon", settledBySalon: true });
    expect(body.data.salon).toEqual({ name: "Salon Test", phone: SALON_PHONE });
  });

  it("200: wpłacony bez płatności succeeded, salon bez telefonu → phone null", async () => {
    selectQueue = [[row({ hoursAhead: 48, salonPhone: null })]];
    const { body } = await get();
    expect(body.data.deposit.action).toBe("salon");
    expect(body.data.salon).toEqual({ name: "Salon Test", phone: null });
  });

  it.each([
    ["bez zadatku (null)", { depositAmount: null }],
    ["zadatek 0", { depositAmount: "0.00" }],
    ["niewpłacony", { depositPaid: false }],
  ])("200: %s → none, bez odczytu płatności", async (_label, opts) => {
    selectQueue = [[row({ hoursAhead: 48, ...opts })]];
    const { body } = await get();
    expect(body.data.deposit.action).toBe("none");
    expect(body.data.deposit.settledBySalon).toBe(false);
    expect(mockSelectSucceeded).not.toHaveBeenCalled();
  });

  it("400: zły UUID", async () => {
    const { status } = await get("not-a-uuid");
    expect(status).toBe(400);
  });

  it.each(["cancelled", "completed"])("400: wizyta %s", async (appointmentStatus) => {
    selectQueue = [[row({ hoursAhead: 48, status: appointmentStatus })]];
    const { status } = await get();
    expect(status).toBe(400);
    expect(mockSelectSucceeded).not.toHaveBeenCalled();
  });

  it("401: brak sesji", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);
    const { status } = await get();
    expect(status).toBe(401);
  });

  it("404: cudza lub nieistniejąca wizyta", async () => {
    selectQueue = [[]];
    const { status } = await get();
    expect(status).toBe(404);
  });

  it("500: błąd bazy przy odczycie wizyty", async () => {
    selectError = new Error("db down");
    const { status } = await get();
    expect(status).toBe(500);
  });

  it("500: błąd odczytu płatności zadatku", async () => {
    selectQueue = [[row({ hoursAhead: 48 })]];
    mockSelectSucceeded.mockRejectedValue(new Error("db down"));
    const { status } = await get();
    expect(status).toBe(500);
  });
});

describe("POST /api/client/appointments/[id]/cancel — zadatek", () => {
  it.each([
    [">24 h", 48],
    ["<24 h", 5],
  ])("bez płatności succeeded (%s): rozlicza salon, bez zwrotu/zatrzymania, update tylko statusu", async (_l, hoursAhead) => {
    selectQueue = [[row({ hoursAhead })]];
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
    expect(mockRefundDeposits).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "cancelled" });
  });

  it("z płatnością succeeded, >24 h: zwrot jak dotąd", async () => {
    selectQueue = [[row({ hoursAhead: 48 })]];
    mockSelectSucceeded.mockResolvedValue([SUCCEEDED_PAYMENT]);
    const { status, body } = await post();
    expect(status).toBe(200);
    expect(body.cancellationDetails).toMatchObject({
      depositRefunded: true,
      depositForfeited: false,
      depositSettledBySalon: false,
      refund: { processed: true, refundId: "re_1", amount: 50 },
    });
    expect(mockRefundDeposits).toHaveBeenCalledTimes(1);
    expect(mockRefundDeposits).toHaveBeenCalledWith(APPOINTMENT_ID, expect.any(String));
  });

  it("z płatnością succeeded, <24 h: zatrzymanie jak dotąd", async () => {
    selectQueue = [[row({ hoursAhead: 5 })]];
    mockSelectSucceeded.mockResolvedValue([SUCCEEDED_PAYMENT]);
    mockRefundDeposits.mockResolvedValue({
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
    expect(mockRefundDeposits).toHaveBeenCalledWith(
      APPOINTMENT_ID,
      expect.any(String),
      expect.objectContaining({ forfeitReason: expect.any(String) })
    );
  });

  it("bez zadatku: nic do rozliczenia, bez odczytu płatności", async () => {
    selectQueue = [[row({ hoursAhead: 48, depositAmount: null, depositPaid: false })]];
    const { body } = await post();
    expect(body.cancellationDetails).toMatchObject({
      depositRefunded: false,
      depositForfeited: false,
      depositSettledBySalon: false,
    });
    expect(mockSelectSucceeded).not.toHaveBeenCalled();
    expect(mockRefundDeposits).not.toHaveBeenCalled();
  });

  it("400: wizyta już się rozpoczęła, bez zmiany statusu", async () => {
    selectQueue = [[row({ hoursAhead: -1 })]];
    const { status } = await post();
    expect(status).toBe(400);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("401: brak sesji", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);
    const { status } = await post();
    expect(status).toBe(401);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("404: cudza lub nieistniejąca wizyta", async () => {
    selectQueue = [[]];
    const { status } = await post();
    expect(status).toBe(404);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("500: błąd odczytu płatności — wizyta nie zostaje anulowana", async () => {
    selectQueue = [[row({ hoursAhead: 48 })]];
    mockSelectSucceeded.mockRejectedValue(new Error("db down"));
    const { status } = await post();
    expect(status).toBe(500);
    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockRefundDeposits).not.toHaveBeenCalled();
  });
});

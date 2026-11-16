/**
 * Cron backstop for dead deposit bookings (review C2 — slot burning DoS).
 *
 * A "scheduled" appointment with an unpaid deposit blocks the slot. The
 * Stripe webhook normally cancels it on checkout.session.expired /
 * async_payment_failed — but if the webhook never arrives, this cron must
 * cancel stale (>45 min) pending/failed deposit bookings so slots are freed.
 *
 * Guards under test:
 * - CRON_SECRET required (fail-closed: missing secret -> 500, bad -> 401)
 * - only stale rows are touched; nothing to do -> zero updates
 * - payment flip is guarded by status='pending' (never downgrades succeeded)
 * - appointment cancel is guarded by status='scheduled' AND depositPaid=false
 * - GET (Vercel Cron) behaves exactly like POST
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockSelectWhere = vi.fn();
const mockDbSelect = vi.fn((..._a: unknown[]) => ({
  from: () => ({ innerJoin: () => ({ where: mockSelectWhere }) }),
}));

const mockTxUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockTxUpdateSet = vi.fn((..._a: unknown[]) => ({ where: mockTxUpdateWhere }));
const mockTxUpdate = vi.fn((..._a: unknown[]) => ({ set: mockTxUpdateSet }));

const mockTx = { update: (...a: unknown[]) => mockTxUpdate(...a) };

// #193 P5a-2: zapytania w wyjściu system/deposits-cleanup.ts (pula systemowa);
// rejestr podaje prawdziwe wyjście, bez ładowania pozostałych modułów system/.
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (...a: unknown[]) => mockDbSelect(...a),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));
vi.mock("@/lib/server/system", async () => ({
  cleanupStaleDepositBookings: (await import("@/lib/server/system/deposits-cleanup")).cleanupStaleDepositBookings,
}));

// Tylko moduł sesji: auth-middleware (bramka CRON_SECRET) zostaje prawdziwy.
// Bez tego prawdziwe auth.ts ładuje adapter z jawnym schematem tabel auth,
// których nie ma w częściowym mocku schematu poniżej.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@/lib/schema", () => ({
  depositPayments: {
    id: "id",
    status: "status",
    appointmentId: "appointmentId",
    createdAt: "createdAt",
  },
  appointments: { id: "id", status: "status", depositPaid: "depositPaid" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ type: "eq", args: a })),
  and: vi.fn((...a: unknown[]) => ({ type: "and", args: a })),
  lt: vi.fn((...a: unknown[]) => ({ type: "lt", args: a })),
  inArray: vi.fn((...a: unknown[]) => ({ type: "inArray", args: a })),
}));

import { GET, POST } from "@/app/api/cron/cleanup-pending-deposits/route";

const CRON_URL = "http://localhost/api/cron/cleanup-pending-deposits";
const SECRET = "test-cron-secret";

function cronRequest(method: "GET" | "POST", secret: string | null = SECRET) {
  return createMockRequest(CRON_URL, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("POST /api/cron/cleanup-pending-deposits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mockSelectWhere.mockResolvedValue([]);
  });

  it("returns 500 when CRON_SECRET is not configured (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const { status } = await parseResponse(
      await POST(cronRequest("POST", "wrong-secret"))
    );
    expect(status).toBe(401);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("no stale bookings -> no updates, reports zero", async () => {
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cancelledAppointments).toBe(0);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("cancels stale pending bookings and marks payments failed", async () => {
    mockSelectWhere.mockResolvedValue([
      { paymentId: "pay-1", paymentStatus: "pending", appointmentId: "appt-1" },
      { paymentId: "pay-2", paymentStatus: "failed", appointmentId: "appt-2" },
    ]);

    const { status, body } = await parseResponse(await POST(cronRequest("POST")));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cancelledAppointments).toBe(2);
    // Only the still-pending payment is flipped to failed
    expect(body.failedPayments).toBe(1);
    // Two updates: depositPayments -> failed, appointments -> cancelled
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ status: "failed" });
    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("skips the payment update when only failed payments are stale", async () => {
    mockSelectWhere.mockResolvedValue([
      { paymentId: "pay-2", paymentStatus: "failed", appointmentId: "appt-2" },
    ]);

    const { body } = await parseResponse(await POST(cronRequest("POST")));

    expect(body.failedPayments).toBe(0);
    expect(body.cancelledAppointments).toBe(1);
    // Single update: appointments only
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdateSet).not.toHaveBeenCalledWith({ status: "failed" });
  });

  it("GET (Vercel Cron) behaves like POST", async () => {
    mockSelectWhere.mockResolvedValue([
      { paymentId: "pay-1", paymentStatus: "pending", appointmentId: "appt-1" },
    ]);

    const { status, body } = await parseResponse(await GET(cronRequest("GET")));

    expect(status).toBe(200);
    expect(body.cancelledAppointments).toBe(1);
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
  });

  it("GET without secret is rejected", async () => {
    const { status } = await parseResponse(await GET(cronRequest("GET", null)));
    expect(status).toBe(401);
  });
});

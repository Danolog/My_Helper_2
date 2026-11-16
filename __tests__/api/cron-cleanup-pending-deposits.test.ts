/**
 * Cron backstop for dead deposit bookings (review C2 — slot burning DoS).
 *
 * A "scheduled" appointment with an unpaid deposit blocks the slot. The
 * Stripe webhook normally cancels it on checkout.session.expired /
 * async_payment_failed — but if the webhook never arrives, this cron must
 * cancel stale (>45 min) deposit bookings so slots are freed.
 *
 * Route-level guards under test:
 * - CRON_SECRET required (fail-closed: missing secret -> 500, bad -> 401)
 * - counters and messages come from the system exit
 * - GET (Vercel Cron) behaves exactly like POST
 *
 * #193 P5a-2: the queries live in `system/deposits-cleanup.ts` (selection and
 * change in one statement). SQL guards and counter mapping:
 * __tests__/lib/system-deposits-cleanup.test.ts; behaviour on a real database
 * (invariant, race, idempotency): __tests__/pg/deposits-cleanup.pg.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn() }));
vi.mock("@/lib/server/system", () => ({
  cleanupStaleDepositBookings: (...a: unknown[]) => cleanup(...a),
}));

// Tylko moduł sesji: auth-middleware (bramka CRON_SECRET) zostaje prawdziwy.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

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
    cleanup.mockResolvedValue({ cancelledAppointments: 0, failedPayments: 0 });
  });

  it("returns 500 when CRON_SECRET is not configured (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const { status } = await parseResponse(
      await POST(cronRequest("POST", "wrong-secret"))
    );
    expect(status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("no stale bookings -> reports zero with the 'nothing to do' message", async () => {
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      message: "Brak martwych rezerwacji z nieoplaconym zadatkiem",
      cancelledAppointments: 0,
      failedPayments: 0,
    });
  });

  it("stale bookings -> counters from the exit (changed rows)", async () => {
    cleanup.mockResolvedValue({ cancelledAppointments: 2, failedPayments: 1 });

    const { status, body } = await parseResponse(await POST(cronRequest("POST")));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      message: "Anulowano 2 rezerwacji z nieoplaconym zadatkiem",
      cancelledAppointments: 2,
      failedPayments: 1,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("exit error -> 500", async () => {
    cleanup.mockRejectedValue(new Error("boom"));
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });

  it("GET (Vercel Cron) behaves like POST", async () => {
    cleanup.mockResolvedValue({ cancelledAppointments: 1, failedPayments: 1 });

    const { status, body } = await parseResponse(await GET(cronRequest("GET")));

    expect(status).toBe(200);
    expect(body.cancelledAppointments).toBe(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("GET without secret is rejected", async () => {
    const { status } = await parseResponse(await GET(cronRequest("GET", null)));
    expect(status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });
});

/**
 * GET /api/subscriptions/payments — historia płatności subskrypcji salonu.
 *
 * Odczyt przez repozytorium salonu (`forSalon(salonId).raw`) z salonId
 * z sesji; warunek `salon_id` jawnie w zapytaniu (raw nie domyka filtra sam).
 * Kontrakt odpowiedzi, filtry i sortowanie bez zmian względem surowego `db`.
 */
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/payments/route";
import { logger } from "@/lib/logger";
import type { SQL } from "drizzle-orm";

const { queue, log, mockForSalon, mockRequireAuth, mockIsAuthError, mockGetUserSalonId } = vi.hoisted(() => ({
  // Wyniki kolejnych zapytań `tx.select()` (FIFO).
  queue: [] as unknown[][],
  // Wyrenderowane warunki `where` i klucze `orderBy` kolejnych zapytań.
  log: {
    where: [] as { sql: string; params: unknown[] }[],
    orderBy: [] as string[][],
  },
  mockForSalon: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (...args: unknown[]) => mockForSalon(...args),
}));

// Trasa nie sięga po surowe `db`; wywołanie = błąd testu.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      throw new Error("surowe db w trasie");
    },
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const dialect = new PgDialect();

function chain() {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "leftJoin"]) builder[method] = () => builder;
  builder.where = (cond: SQL) => {
    const q = dialect.sqlToQuery(cond);
    log.where.push({ sql: q.sql, params: q.params });
    return builder;
  };
  builder.orderBy = (...keys: SQL[]) => {
    log.orderBy.push(keys.map((k) => dialect.sqlToQuery(k).sql));
    return builder;
  };
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(resolve, reject);
  return builder;
}

const tx = { select: vi.fn(() => chain()) };

const SALON = "salon-1";
const ERROR_BODY = { success: false, error: "Nie udalo sie pobrac historii platnosci" };

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    subscriptionId: "sub-1",
    amount: "149.00",
    currency: "PLN",
    status: "succeeded",
    stripePaymentIntentId: "pi_1",
    paidAt: "2026-11-01T10:00:00.000Z",
    createdAt: "2026-11-01T10:00:00.000Z",
    subscriptionStatus: "active",
    currentPeriodStart: "2026-11-01T00:00:00.000Z",
    currentPeriodEnd: "2026-12-01T00:00:00.000Z",
    planName: "Pro",
    planSlug: "pro",
    planPrice: "149.00",
    ...overrides,
  };
}

function req(query = "") {
  return new NextRequest(`http://localhost/api/subscriptions/payments${query}`);
}

beforeEach(() => {
  queue.length = 0;
  log.where.length = 0;
  log.orderBy.length = 0;
  tx.select.mockClear();
  vi.mocked(logger.error).mockClear();
  mockForSalon.mockReset().mockImplementation((salonId: string) => ({
    salonId,
    raw: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }));
  mockRequireAuth.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  mockIsAuthError.mockReset().mockReturnValue(false);
  mockGetUserSalonId.mockReset().mockResolvedValue(SALON);
});

describe("GET /api/subscriptions/payments — odpowiedź", () => {
  it("200: płatności, paginacja i podsumowanie w niezmienionym kształcie", async () => {
    queue.push([
      payment(),
      payment({ id: "pay-2", status: "pending", amount: "49.00", planName: null, planSlug: null }),
      payment({ id: "pay-3", status: "failed", amount: "10.50" }),
    ]);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.payments).toHaveLength(3);
    expect(body.data.payments[0]).toEqual({
      id: "pay-1",
      subscriptionId: "sub-1",
      amount: "149.00",
      currency: "PLN",
      status: "succeeded",
      stripePaymentIntentId: "pi_1",
      paidAt: "2026-11-01T10:00:00.000Z",
      createdAt: "2026-11-01T10:00:00.000Z",
      planName: "Pro",
      planSlug: "pro",
      planPrice: "149.00",
      subscriptionStatus: "active",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-12-01T00:00:00.000Z",
    });
    expect(body.data.payments[1].planName).toBe("Nieznany plan");
    expect(body.data.payments[1].planSlug).toBe("unknown");
    expect(body.data.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(body.data.summary).toEqual({
      totalSucceeded: "149.00",
      totalPending: "49.00",
      totalFailed: "10.50",
      paymentCount: 3,
      succeededCount: 1,
      pendingCount: 1,
      failedCount: 1,
    });
  });

  it("200: paginacja tnie listę, podsumowanie liczy wszystkie wiersze", async () => {
    queue.push([payment({ id: "a" }), payment({ id: "b" }), payment({ id: "c" })]);

    const body = await (await GET(req("?page=2&limit=2"))).json();

    expect(body.data.payments.map((p: { id: string }) => p.id)).toEqual(["c"]);
    expect(body.data.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(body.data.summary.paymentCount).toBe(3);
  });

  it("200: brak płatności -> pusta lista i zera", async () => {
    queue.push([]);

    const body = await (await GET(req())).json();

    expect(body.data.payments).toEqual([]);
    expect(body.data.summary.totalSucceeded).toBe("0.00");
    expect(body.data.pagination.totalPages).toBe(0);
  });

  it("sortowanie: created_at malejąco", async () => {
    queue.push([]);
    await GET(req());
    expect(log.orderBy).toEqual([['"subscription_payments"."created_at" desc']]);
  });

  it("filtry: status, dateFrom (>=) i dateTo (<= dzień po dacie)", async () => {
    queue.push([]);

    await GET(req("?status=failed&dateFrom=2026-11-01&dateTo=2026-11-10"));

    expect(log.where).toHaveLength(1);
    const { sql, params } = log.where[0]!;
    expect(sql).toContain('"subscription_payments"."status" = $');
    expect(sql).toContain('"subscription_payments"."created_at" >= $');
    expect(sql).toContain('"subscription_payments"."created_at" <= $');
    expect(params).toContain("failed");
    expect(params).toContain(new Date("2026-11-01").toISOString());
    expect(params).toContain(new Date("2026-11-11").toISOString());
  });
});

describe("GET /api/subscriptions/payments — izolacja salonu", () => {
  it("forSalon z salonId z sesji, nie z parametru; warunek salon_id jawnie w raw", async () => {
    queue.push([payment()]);

    const res = await GET(req("?salonId=salon-obcy"));

    expect(res.status).toBe(200);
    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith(SALON);
    expect(log.where).toHaveLength(1);
    expect(log.where[0]!.sql).toContain('"subscription_payments"."salon_id" = $');
    expect(log.where[0]!.params).toContain(SALON);
    expect(log.where[0]!.params).not.toContain("salon-obcy");
  });
});

describe("GET /api/subscriptions/payments — sesja i błędy", () => {
  it("401: brak sesji, bez odczytu", async () => {
    mockRequireAuth.mockResolvedValue(Response.json({ success: false, error: "Unauthorized" }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);

    expect((await GET(req())).status).toBe(401);
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("404: użytkownik bez salonu, bez odczytu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Salon not found" });
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("500: błąd bazy (raw odrzucone) -> stała treść i wpis w logu", async () => {
    mockForSalon.mockImplementation((salonId: string) => ({
      salonId,
      raw: () => Promise.reject(new Error("db down")),
    }));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(ERROR_BODY);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

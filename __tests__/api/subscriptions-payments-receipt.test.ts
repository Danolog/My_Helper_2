/**
 * GET /api/subscriptions/payments/[id]/receipt — potwierdzenie płatności (HTML).
 *
 * Odczyt przez repozytorium salonu (`forSalon(salonId).raw`) z salonId
 * z sesji; warunek `salon_id` jawnie w zapytaniu obok `id` płatności,
 * więc płatność innego salonu daje 404 tak samo jak nieistniejąca.
 */
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/payments/[id]/receipt/route";
import { logger } from "@/lib/logger";
import type { SQL } from "drizzle-orm";

const { queue, log, mockForSalon, mockRequireAuth, mockIsAuthError, mockGetUserSalonId } = vi.hoisted(() => ({
  // Wyniki kolejnych zapytań `tx.select()` (FIFO).
  queue: [] as unknown[][],
  // Wyrenderowane warunki `where` i argumenty `limit` kolejnych zapytań.
  log: {
    where: [] as { sql: string; params: unknown[] }[],
    limit: [] as number[],
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
  builder.limit = (n: number) => {
    log.limit.push(n);
    return builder;
  };
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(resolve, reject);
  return builder;
}

const tx = { select: vi.fn(() => chain()) };

const SALON = "salon-1";
const PAYMENT_ID = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    amount: "149.00",
    currency: "PLN",
    status: "succeeded",
    stripePaymentIntentId: "pi_123",
    paidAt: new Date("2026-11-05T10:00:00.000Z"),
    createdAt: new Date("2026-11-05T09:00:00.000Z"),
    planName: "Pro",
    planSlug: "pro",
    planPrice: "149.00",
    salonName: "Salon Testowy",
    salonAddress: "ul. Testowa 1",
    salonPhone: "+48 500 000 000",
    salonEmail: "salon@example.com",
    subscriptionId: "sub-1",
    currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

function call(id = PAYMENT_ID) {
  return GET(new NextRequest(`http://localhost/api/subscriptions/payments/${id}/receipt`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  queue.length = 0;
  log.where.length = 0;
  log.limit.length = 0;
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

describe("GET /api/subscriptions/payments/[id]/receipt — odpowiedź", () => {
  it("200: HTML potwierdzenia z numerem, nabywcą i kwotami", async () => {
    queue.push([receiptRow()]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("SUB/2026/11/3F2B8C1E");
    expect(html).toContain("Salon Testowy");
    expect(html).toContain("ul. Testowa 1");
    expect(html).toContain("149.00 PLN");
    expect(html).toContain("pi_123");
    expect(html).toContain("Zaplacono");
  });

  it("200: bez danych planu i salonu (left join null) -> wartości zastępcze", async () => {
    queue.push([
      receiptRow({ planName: null, salonName: null, salonAddress: null, stripePaymentIntentId: null, paidAt: null }),
    ]);

    const html = await (await call()).text();

    expect(html).toContain("Subskrypcja MyHelper");
    expect(html).toContain("<strong>Salon</strong>");
    expect(html).not.toContain("ID transakcji");
  });
});

describe("GET /api/subscriptions/payments/[id]/receipt — izolacja salonu", () => {
  it("forSalon z salonId z sesji; warunek id i salon_id jawnie w raw, limit 1", async () => {
    mockGetUserSalonId.mockResolvedValue("salon-z-sesji");
    queue.push([receiptRow()]);

    expect((await call()).status).toBe(200);

    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith("salon-z-sesji");
    expect(log.where).toHaveLength(1);
    const { sql, params } = log.where[0]!;
    expect(sql).toContain('"subscription_payments"."id" = $');
    expect(sql).toContain('"subscription_payments"."salon_id" = $');
    expect(params).toEqual([PAYMENT_ID, "salon-z-sesji"]);
    expect(log.limit).toEqual([1]);
  });

  it("404: płatność innego salonu albo nieistniejąca (brak wiersza)", async () => {
    queue.push([]);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Platnosc nie zostala znaleziona" });
  });
});

describe("GET /api/subscriptions/payments/[id]/receipt — sesja, walidacja i błędy", () => {
  it("401: brak sesji, bez odczytu", async () => {
    mockRequireAuth.mockResolvedValue(Response.json({ success: false, error: "Unauthorized" }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);

    expect((await call()).status).toBe(401);
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("404: użytkownik bez salonu, bez odczytu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Salon not found" });
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("400: id nie jest UUID, bez odczytu", async () => {
    const res = await call("nie-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Nieprawidłowy ID" });
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("500: błąd bazy (raw odrzucone) -> stała treść i wpis w logu", async () => {
    mockForSalon.mockImplementation((salonId: string) => ({
      salonId,
      raw: () => Promise.reject(new Error("db down")),
    }));

    const res = await call();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "Nie udalo sie wygenerowac potwierdzenia platnosci",
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

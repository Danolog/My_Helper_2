/**
 * POST /api/subscriptions/renew — okres subskrypcji przedłuża wyłącznie Stripe.
 *
 * Przed poprawką właściciel z aktywną subskrypcją mógł kliknąć „Odnów teraz”
 * / „Symuluj odnowienie”: trasa przesuwała `currentPeriodEnd` o miesiąc
 * i zapisywała fikcyjną płatność `succeeded` (`sim_renewal_pi_*`) bez
 * żadnego obciążenia w Stripe — darmowy miesiąc na żądanie, bez limitu.
 *
 * Kontrakt po poprawce: POST nigdy nie zapisuje subskrypcji ani płatności.
 * Odnowienie robi webhook `invoice.paid` (podpisany przez Stripe).
 * Stripe nieskonfigurowany → 503 STRIPE_UNAVAILABLE (jak checkout w PR #36),
 * Stripe skonfigurowany → 409 RENEWAL_MANAGED_BY_STRIPE. GET (informacja
 * o najbliższym odnowieniu) bez zmian.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/subscriptions/renew/route";
import type { SQL } from "drizzle-orm";

const dialect = new PgDialect();

const {
  selectQueue,
  mockUpdate,
  mockInsert,
  mockTransaction,
  mockRequireAuth,
  mockIsAuthError,
  mockGetUserSalonId,
  mockGetStripe,
  mockForSalon,
  rawFailure,
  whereLog,
} = vi.hoisted(() => ({
  mockForSalon: vi.fn(),
  // Warunki `where` kolejnych zapytań `tx.select()` (SQL drizzle).
  whereLog: [] as unknown[],
  // Ustawiony błąd = `raw` odrzucone (błąd bazy).
  rawFailure: { error: null as Error | null },
  selectQueue: [] as unknown[][],
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockTransaction: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
}));

// Trasa czyta przez repozytorium salonu; `raw` podaje `tx` atrapy.
vi.mock("@/lib/server/repository", () => {
  const selectChain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.where = (cond: unknown) => {
      whereLog.push(cond);
      return builder;
    };
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return builder;
  };
  // Zapis zwraca wiersz, żeby stary kod doszedł do końca i test pokazał
  // realny efekt (200 + zapis), a nie wyjątek z mocka.
  const writeChain = (spy: (...a: unknown[]) => unknown) => (...args: unknown[]) => {
    spy(...args);
    const builder: Record<string, unknown> = {};
    for (const method of ["set", "values", "where", "onConflictDoNothing"]) {
      builder[method] = (...a: unknown[]) => {
        spy(method, ...a);
        return builder;
      };
    }
    builder.returning = () => Promise.resolve([{ id: "row-written" }]);
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject);
    return builder;
  };
  const tx = {
    select: () => selectChain(),
    update: writeChain(mockUpdate),
    insert: writeChain(mockInsert),
    transaction: (fn: (t: unknown) => unknown) => {
      mockTransaction();
      return fn(tx);
    },
  };
  return {
    forSalon: (salonId: string) => {
      mockForSalon(salonId);
      return {
        salonId,
        raw: (fn: (t: typeof tx) => unknown) => (rawFailure.error ? Promise.reject(rawFailure.error) : fn(tx)),
      };
    },
  };
});

// Trasa nie sięga po surowe `db`; wywołanie = błąd testu.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      throw new Error("surowe db w trasie");
    },
    update: () => {
      throw new Error("surowe db w trasie");
    },
    insert: () => {
      throw new Error("surowe db w trasie");
    },
    transaction: () => {
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

// Atrapa klienta Stripe — zero wywołań sieciowych.
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
}));

const PLAN_PRO = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  isActive: true,
};

const ACTIVE_SUB = {
  id: "sub-1",
  salonId: "salon-1",
  planId: PLAN_PRO.id,
  stripeSubscriptionId: "sim_sub_1",
  stripeCustomerId: "sim_cus_1",
  status: "active",
  currentPeriodStart: new Date("2026-10-14T00:00:00Z"),
  currentPeriodEnd: new Date("2026-11-14T00:00:00Z"),
  scheduledPlanId: null,
  scheduledChangeAt: null,
};

function expectNoWrites() {
  expect(mockTransaction).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  rawFailure.error = null;
  whereLog.length = 0;
  mockRequireAuth.mockResolvedValue({ user: { id: "owner-1" } });
  mockIsAuthError.mockReturnValue(false);
  mockGetUserSalonId.mockResolvedValue("salon-1");
  mockGetStripe.mockReturnValue(null);
});

describe("POST /api/subscriptions/renew", () => {
  it("bez Stripe: 503 STRIPE_UNAVAILABLE, okres nieprzesunięty, brak płatności", async () => {
    selectQueue.push([{ subscription: ACTIVE_SUB, plan: PLAN_PRO }]);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.code).toBe("STRIPE_UNAVAILABLE");
    expectNoWrites();
  });

  it("ze Stripe: 409 RENEWAL_MANAGED_BY_STRIPE, zero zapisów i zero wywołań Stripe", async () => {
    const stripe = { checkout: { sessions: { create: vi.fn() } }, invoices: { pay: vi.fn() } };
    mockGetStripe.mockReturnValue(stripe);
    selectQueue.push([{ subscription: ACTIVE_SUB, plan: PLAN_PRO }]);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe("RENEWAL_MANAGED_BY_STRIPE");
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("ze zaplanowaną zmianą planu: nie stosuje jej (to robi invoice.paid)", async () => {
    selectQueue.push([
      { subscription: { ...ACTIVE_SUB, scheduledPlanId: "plan-basic" }, plan: PLAN_PRO },
    ]);
    selectQueue.push([{ id: "plan-basic", name: "Basic", slug: "basic", priceMonthly: "49.00" }]);

    const res = await POST();

    expect(res.status).toBe(503);
    expectNoWrites();
  });

  it("niezalogowany: zwraca odpowiedź auth i nic nie zapisuje", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
    mockRequireAuth.mockResolvedValue(unauthorized);
    mockIsAuthError.mockReturnValue(true);

    const res = await POST();

    expect(res.status).toBe(401);
    expectNoWrites();
  });

  it("odpowiedź błędu bez stack trace i bez danych subskrypcji", async () => {
    selectQueue.push([{ subscription: ACTIVE_SUB, plan: PLAN_PRO }]);

    const body = await (await POST()).json();

    expect(body).not.toHaveProperty("subscription");
    expect(body).not.toHaveProperty("payment");
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts/);
  });
});

describe("GET /api/subscriptions/renew (bez zmian)", () => {
  it("zwraca informację o najbliższym odnowieniu i nic nie zapisuje", async () => {
    selectQueue.push([{ subscription: ACTIVE_SUB, plan: PLAN_PRO }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.renewal.subscriptionId).toBe("sub-1");
    expect(body.renewal.renewalAmount).toBe("149.00");
    expectNoWrites();
  });

  it("brak salonu: 404", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("izolacja: odczyt przez forSalon z salonId z sesji", async () => {
    mockGetUserSalonId.mockResolvedValue("salon-z-sesji");
    selectQueue.push([{ subscription: { ...ACTIVE_SUB, salonId: "salon-z-sesji" }, plan: PLAN_PRO }]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith("salon-z-sesji");
    // `raw` nie domyka filtra sam — warunek salonu jawnie w zapytaniu.
    const q = dialect.sqlToQuery(whereLog[0] as SQL);
    expect(q.sql).toContain('"salon_subscriptions"."salon_id" = $');
    expect(q.params).toContain("salon-z-sesji");
  });

  it("zaplanowana zmiana planu: kwota odnowienia z planu docelowego", async () => {
    selectQueue.push([
      { subscription: { ...ACTIVE_SUB, scheduledPlanId: "plan-basic" }, plan: PLAN_PRO },
    ]);
    selectQueue.push([{ id: "plan-basic", name: "Basic", slug: "basic", priceMonthly: "49.00" }]);

    const body = await (await GET()).json();

    expect(body.renewal.renewalAmount).toBe("49.00");
    expect(body.renewal.scheduledPlanChange).toEqual({
      id: "plan-basic",
      name: "Basic",
      slug: "basic",
      priceMonthly: "49.00",
    });
    expect(body.renewal.currentPlan.slug).toBe("pro");
  });

  it("brak aktywnej subskrypcji: 200 z renewal null", async () => {
    selectQueue.push([]);

    const body = await (await GET()).json();

    expect(body).toEqual({ success: true, renewal: null, message: "Brak aktywnej subskrypcji" });
  });

  it("niezalogowany: 401 bez odczytu", async () => {
    mockRequireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);

    expect((await GET()).status).toBe(401);
    expect(mockForSalon).not.toHaveBeenCalled();
  });

  it("błąd bazy: 500 ze stałą treścią", async () => {
    rawFailure.error = new Error("db down");

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "Nie udalo sie pobrac informacji o odnowieniu",
    });
  });
});

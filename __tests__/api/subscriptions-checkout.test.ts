/**
 * POST /api/subscriptions/checkout — płatny plan tylko po płatności w Stripe.
 *
 * Przed poprawką endpoint przyznawał plan bez płatności:
 * - zmiana planu istniejącej aktywnej subskrypcji podmieniała `planId`
 *   i zapisywała „symulowaną” płatność `succeeded` bez Stripe;
 * - gdy Stripe nie był skonfigurowany albo wywołanie padło, tworzył
 *   (albo reaktywował z trialu) aktywną subskrypcję z płatnością `sim_pi_*`.
 *
 * Kontrakt po poprawce: endpoint nigdy nie zapisuje subskrypcji ani płatności.
 * Tworzy tylko sesję Stripe Checkout; subskrypcję zapisuje /api/subscriptions/confirm
 * po zweryfikowanej płatności (payment_status === "paid").
 * Stripe niedostępny → 503, błąd Stripe → 502, w obu przypadkach zero zapisów.
 *
 * Uwaga: obecny schemat wejścia (`subscriptionCheckoutSchema`) wymaga
 * `salonId` + `planId`, a trasa czyta `planSlug` — rozjazd kontraktu naprawia
 * osobny commit (PR #32). Testy wysyłają oba, żeby przejść walidację.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/subscriptions/checkout/route";

const {
  selectQueue,
  mockUpdate,
  mockInsert,
  mockTransaction,
  mockRequireAuth,
  mockIsAuthError,
  mockGetUserSalonId,
  mockGetStripe,
  mockIsStripePricesConfigured,
  mockSessionsCreate,
  mockRateLimitCheck,
} = vi.hoisted(() => ({
  // Kolejne `db.select()` / `tx.select()` zdejmują wyniki z kolejki (FIFO).
  selectQueue: [] as unknown[][],
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockTransaction: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
  mockIsStripePricesConfigured: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockRateLimitCheck: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const selectChain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return builder;
  };
  // Zapis zwraca wiersz, żeby stary kod (symulacja) doszedł do końca i
  // test pokazał realny efekt: 200 + zapis, a nie wyjątek z mocka.
  const writeChain = (spy: (...a: unknown[]) => unknown) => (...args: unknown[]) => {
    spy(...args);
    const builder: Record<string, unknown> = {};
    for (const method of ["set", "values", "where", "onConflictDoNothing"]) {
      builder[method] = (...a: unknown[]) => {
        spy(method, ...a);
        return builder;
      };
    }
    builder.returning = () => Promise.resolve([{ id: "sub-written" }]);
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject);
    return builder;
  };
  const tx = {
    select: () => selectChain(),
    update: writeChain(mockUpdate),
    insert: writeChain(mockInsert),
  };
  return {
    db: {
      select: () => selectChain(),
      update: writeChain(mockUpdate),
      insert: writeChain(mockInsert),
      transaction: (fn: (t: typeof tx) => unknown) => {
        mockTransaction();
        return fn(tx);
      },
    },
  };
});

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

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: (...a: unknown[]) => mockRateLimitCheck(...a) },
  getClientIp: () => "127.0.0.1",
}));

// Atrapa klienta Stripe — zero wywołań sieciowych.
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
  isStripePricesConfigured: (...a: unknown[]) => mockIsStripePricesConfigured(...a),
}));

const PLAN_BASIC = {
  id: "plan-basic",
  name: "Basic",
  slug: "basic",
  priceMonthly: "49.00",
  isActive: true,
};
const PLAN_PRO = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  isActive: true,
};

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    salonId: "salon-1",
    planId: PLAN_BASIC.id,
    stripeSubscriptionId: "sim_sub_1",
    stripeCustomerId: "sim_cus_1",
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    ...overrides,
  };
}

function checkoutRequest(planSlug: string) {
  return new Request("http://localhost:3000/api/subscriptions/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planSlug, salonId: "salon-1", planId: `plan-${planSlug}` }),
  });
}

function stripeClient() {
  return { checkout: { sessions: { create: mockSessionsCreate } } };
}

function expectNoWrites() {
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockTransaction).not.toHaveBeenCalled();
}

describe("POST /api/subscriptions/checkout", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    mockUpdate.mockReset();
    mockInsert.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth
      .mockReset()
      .mockResolvedValue({ user: { id: "user-1", email: "wlasciciel@test.pl" } });
    mockIsAuthError.mockReset().mockReturnValue(false);
    mockGetUserSalonId.mockReset().mockResolvedValue("salon-1");
    mockGetStripe.mockReset().mockReturnValue(null);
    mockIsStripePricesConfigured.mockReset().mockReturnValue(false);
    mockSessionsCreate.mockReset().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    mockRateLimitCheck.mockReset().mockReturnValue({ success: true, remaining: 4, reset: 60000 });
  });

  describe("(a) zmiana planu istniejącej aktywnej subskrypcji", () => {
    it("Basic → Pro bez Stripe: 503, planId bez zmian, brak płatności", async () => {
      selectQueue.push([PLAN_PRO], [subscriptionRow()]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.code).toBe("STRIPE_UNAVAILABLE");
      expect(body.error).toMatch(/płatności/i);
      expectNoWrites();
    });

    it("Basic → Pro ze Stripe (subskrypcja bez prawdziwego Stripe): sesja Checkout, zero zapisów", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_PRO], [subscriptionRow()]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
      const params = mockSessionsCreate.mock.calls[0]![0];
      expect(params.mode).toBe("subscription");
      expect(params.metadata).toMatchObject({ salonId: "salon-1", planId: PLAN_PRO.id });
      expectNoWrites();
    });

    it("Basic → Pro przy opłaconej subskrypcji Stripe: 409, bez drugiej subskrypcji w Stripe", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_PRO], [subscriptionRow({ stripeSubscriptionId: "sub_1Real" })]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("PLAN_CHANGE_UNSUPPORTED");
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("ten sam plan: 409, zero zapisów", async () => {
      selectQueue.push([PLAN_BASIC], [subscriptionRow()]);

      const res = await POST(checkoutRequest("basic"));

      expect(res.status).toBe(409);
      expectNoWrites();
    });
  });

  describe("(b) Stripe nieskonfigurowany", () => {
    it("nowa subskrypcja: 503 z czytelnym komunikatem, brak aktywnej subskrypcji", async () => {
      selectQueue.push([PLAN_PRO], []);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.code).toBe("STRIPE_UNAVAILABLE");
      expect(body.error).toMatch(/płatności/i);
      expect(body.url).toBeUndefined();
      expectNoWrites();
    });

    it("trial 14 dni: 503 i trial zostaje nietknięty (brak reaktywacji na active)", async () => {
      // Zapytanie o status "active" nie widzi subskrypcji w trialu.
      selectQueue.push([PLAN_PRO], [], [subscriptionRow({ status: "trialing" })]);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(503);
      expectNoWrites();
    });
  });

  describe("(c) Stripe rzuca błąd", () => {
    it("checkout.sessions.create pada: 502, brak zapisu", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      mockSessionsCreate.mockRejectedValue(new Error("Invalid API Key provided"));
      selectQueue.push([PLAN_PRO], []);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.success).toBe(false);
      expect(body.code).toBe("STRIPE_ERROR");
      // Treść błędu Stripe nie wycieka do klienta.
      expect(JSON.stringify(body)).not.toMatch(/API Key/);
      expectNoWrites();
    });
  });

  describe("ścieżka poprawna i błędy wejścia", () => {
    it("nowa subskrypcja ze Stripe: 200 z URL Checkout, zero zapisów", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_BASIC], []);

      const res = await POST(checkoutRequest("basic"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        success: true,
        url: "https://checkout.stripe.com/c/pay/cs_test_1",
      });
      const params = mockSessionsCreate.mock.calls[0]![0];
      expect(params.customer_email).toBe("wlasciciel@test.pl");
      expect(params.success_url).toContain("/dashboard/subscription/success?session_id=");
      expectNoWrites();
    });

    it("401 bez sesji", async () => {
      const { NextResponse } = await import("next/server");
      mockRequireAuth.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      mockIsAuthError.mockReturnValue(true);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(401);
      expectNoWrites();
    });

    it("404 gdy użytkownik nie ma salonu", async () => {
      mockGetUserSalonId.mockResolvedValue(null);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(404);
      expectNoWrites();
    });

    it("400 przy niepoprawnym planSlug", async () => {
      const res = await POST(checkoutRequest("enterprise"));

      expect(res.status).toBe(400);
      expectNoWrites();
    });

    it("404 gdy planu nie ma w bazie", async () => {
      selectQueue.push([]);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(404);
      expectNoWrites();
    });

    it("429 z Retry-After przy przekroczonym limicie", async () => {
      mockRateLimitCheck.mockReturnValue({ success: false, remaining: 0, reset: 30000 });

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("30");
      expectNoWrites();
    });
  });
});

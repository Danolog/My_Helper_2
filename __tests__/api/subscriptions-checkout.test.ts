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
 * Kontrakt wejścia = body z UI: `{ planSlug }` z
 * src/app/(site)/pricing/page.tsx i
 * src/app/dashboard/subscription/_hooks/use-subscription-data.ts.
 * Salon wyłącznie z sesji — `salonId` w body nie jest częścią kontraktu.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/subscriptions/checkout/route";

const {
  selectQueue,
  selectWheres,
  accessQueue,
  accessWheres,
  mockForSalon,
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
  // Argumenty `.where(...)` kolejnych SELECT-ów (filtr renderowany przez PgDialect).
  selectWheres: [] as unknown[],
  // Odczyt przez repozytorium salonu (`forSalon(salonId).raw`): wszystkie
  // wiersze subskrypcji salonu z planem. Error w kolejce = odrzucone zapytanie.
  accessQueue: [] as (unknown[] | Error)[],
  accessWheres: [] as unknown[],
  mockForSalon: vi.fn(),
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
    for (const method of ["from", "innerJoin", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.where = (cond: unknown) => {
      selectWheres.push(cond);
      return builder;
    };
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

vi.mock("@/lib/server/repository", () => {
  const accessChain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.where = (cond: unknown) => {
      accessWheres.push(cond);
      return builder;
    };
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      const next = accessQueue.shift() ?? [];
      if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
      return Promise.resolve(next).then(resolve, reject);
    };
    return builder;
  };
  const tx = { select: () => accessChain() };
  return {
    forSalon: (salonId: string) => {
      mockForSalon(salonId);
      return { raw: (fn: (t: typeof tx) => unknown) => fn(tx), salonId };
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

function rawCheckoutRequest(body: unknown) {
  return new Request("http://localhost:3000/api/subscriptions/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Dokładnie to, co wysyła UI (pricing + zmiana planu w panelu).
function checkoutRequest(planSlug: string) {
  return rawCheckoutRequest({ planSlug });
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
    selectWheres.length = 0;
    accessQueue.length = 0;
    accessWheres.length = 0;
    mockForSalon.mockReset();
    mockUpdate.mockReset();
    mockInsert.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth
      .mockReset()
      .mockResolvedValue({ user: { id: "user-1", email: "wlasciciel@example.com" } });
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

  // Ten sam predykat konfliktu co confirm (`isCurrentPaidStripeRow`) —
  // klient dowiaduje się o konflikcie PRZED pobraniem pieniędzy.
  describe("(e) predykat konfliktu jak w confirm: trialing z prawdziwą subskrypcją Stripe", () => {
    it("trial prowadzony przez Stripe (prawdziwe id), inny plan: 409 PLAN_CHANGE_UNSUPPORTED, bez sesji Stripe", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push(
        [PLAN_PRO],
        [subscriptionRow({ status: "trialing", stripeSubscriptionId: "sub_1RealTrial" })]
      );

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("PLAN_CHANGE_UNSUPPORTED");
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("trial prowadzony przez Stripe, ten sam plan: 409, bez sesji Stripe", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push(
        [PLAN_BASIC],
        [subscriptionRow({ status: "trialing", stripeSubscriptionId: "sub_1RealTrial" })]
      );

      const res = await POST(checkoutRequest("basic"));

      expect(res.status).toBe(409);
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("nasz trial z rejestracji (stripeSubscriptionId = null), ten sam plan: sesja Checkout (trial → płatny)", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_BASIC], [subscriptionRow({ status: "trialing", stripeSubscriptionId: null })]);

      const res = await POST(checkoutRequest("basic"));

      expect(res.status).toBe(200);
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
      expectNoWrites();
    });

    it("zapytanie o istniejące wiersze obejmuje trialing i active (nie tylko active)", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_PRO], []);

      await POST(checkoutRequest("pro"));

      // drugi SELECT = wiersze subskrypcji salonu
      const { params } = new PgDialect().sqlToQuery(selectWheres[1] as SQL);
      expect(params).toEqual(expect.arrayContaining(["salon-1", "trialing", "active"]));
    });

    it("wiersz canceled z prawdziwym id bez końca okresu (historia) nie blokuje nowego Checkoutu", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      // Zapytanie o wiersze bieżące filtruje trialing/active; gdyby atrapa
      // zwróciła historię, ta reguła jej nie liczy. Odczyt wszystkich wierszy
      // widzi ten wiersz, ale bez końca okresu nie daje on pełnego dostępu.
      const historic = subscriptionRow({ status: "canceled", stripeSubscriptionId: "sub_old" });
      selectQueue.push([PLAN_PRO], [historic]);
      accessQueue.push([{ subscription: { ...historic, createdAt: new Date("2026-01-01T00:00:00.000Z") }, plan: PLAN_BASIC }]);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(200);
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    });
  });

  // Pełny dostęp z anulowanej albo zaległej subskrypcji Stripe (reguła
  // `resolveSalonAccess` na wszystkich wierszach salonu): nowy Checkout
  // założyłby drugą subskrypcję w Stripe, więc trasa odmawia do końca dostępu.
  describe("(f) pełny dostęp z anulowanej albo zaległej subskrypcji Stripe", () => {
    const NOW = new Date("2026-11-19T10:00:00.000Z");
    const DAY = 86_400_000;

    function accessRow(overrides: Record<string, unknown> = {}) {
      return {
        subscription: subscriptionRow({
          status: "canceled",
          stripeSubscriptionId: "sub_1Real",
          createdAt: new Date("2026-10-01T10:00:00.000Z"),
          ...overrides,
        }),
        plan: PLAN_BASIC,
      };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      mockGetStripe.mockReturnValue(stripeClient());
      // Zapytanie o wiersze bieżące (trialing/active) nie widzi canceled/past_due.
      selectQueue.push([PLAN_PRO], []);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function expectCheckoutCreated() {
      const res = await POST(checkoutRequest("pro"));
      expect(res.status).toBe(200);
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
      expectNoWrites();
    }

    it("canceled z prawdziwą subskrypcją Stripe, koniec okresu w przyszłości: 409 PURCHASE_BLOCKED_UNTIL_PERIOD_END z until = koniec okresu, bez sesji Stripe i zapisów", async () => {
      const periodEnd = new Date("2026-12-01T10:00:00.000Z");
      accessQueue.push([accessRow({ currentPeriodEnd: periodEnd })]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toEqual({
        success: false,
        code: "PURCHASE_BLOCKED_UNTIL_PERIOD_END",
        until: "2026-12-01T10:00:00.000Z",
        error: "Subskrypcja jest anulowana, ale dostęp trwa do 01.12.2026. Nowy zakup będzie możliwy po tym terminie.",
      });
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
      // Odczyt przez repozytorium salonu z sesji, z jawnym filtrem salonu.
      expect(mockForSalon).toHaveBeenCalledWith("salon-1");
      const { params } = new PgDialect().sqlToQuery(accessWheres[0] as SQL);
      expect(params).toEqual(["salon-1"]);
    });

    it("canceled z prawdziwą subskrypcją Stripe, koniec okresu w przeszłości: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ currentPeriodEnd: new Date(NOW.getTime() - DAY) })]);
      await expectCheckoutCreated();
    });

    it("canceled z prawdziwą subskrypcją Stripe, koniec okresu równy chwili bieżącej: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ currentPeriodEnd: new Date(NOW.getTime()) })]);
      await expectCheckoutCreated();
    });

    it("canceled z prawdziwą subskrypcją Stripe bez końca okresu: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ currentPeriodEnd: null })]);
      await expectCheckoutCreated();
    });

    it("canceled w okresie ze stripeSubscriptionId = null: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ stripeSubscriptionId: null, currentPeriodEnd: new Date(NOW.getTime() + DAY) })]);
      await expectCheckoutCreated();
    });

    it("canceled w okresie ze stripeSubscriptionId sim_…: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ stripeSubscriptionId: "sim_sub_1", currentPeriodEnd: new Date(NOW.getTime() + DAY) })]);
      await expectCheckoutCreated();
    });

    it("past_due z prawdziwą subskrypcją Stripe po końcu okresu, w 7 dniach karencji: 409 z until = koniec okresu + 7 dni i tekstem o zaległej płatności", async () => {
      const periodEnd = new Date("2026-11-17T10:00:00.000Z");
      accessQueue.push([accessRow({ status: "past_due", currentPeriodEnd: periodEnd })]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toEqual({
        success: false,
        code: "PURCHASE_BLOCKED_UNTIL_PERIOD_END",
        until: "2026-11-24T10:00:00.000Z",
        error:
          "Płatność za subskrypcję jest zaległa. Nowy zakup będzie możliwy po 24.11.2026. W sprawie zaległej płatności skontaktuj się z obsługą.",
      });
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("past_due z prawdziwą subskrypcją Stripe po końcu okresu + 7 dni: sesja Checkout (200)", async () => {
      accessQueue.push([accessRow({ status: "past_due", currentPeriodEnd: new Date(NOW.getTime() - 8 * DAY) })]);
      await expectCheckoutCreated();
    });

    it("past_due w karencji bez prawdziwej subskrypcji Stripe (null): sesja Checkout (200)", async () => {
      accessQueue.push([
        accessRow({ status: "past_due", stripeSubscriptionId: null, currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY) }),
      ]);
      await expectCheckoutCreated();
    });

    it("nowszy canceled w okresie z prawdziwą subskrypcją + starszy canceled po okresie: 409", async () => {
      accessQueue.push([
        accessRow({ id: "sub-new", createdAt: new Date("2026-10-01T10:00:00.000Z"), currentPeriodEnd: new Date(NOW.getTime() + DAY) }),
        accessRow({ id: "sub-old", createdAt: new Date("2026-08-01T10:00:00.000Z"), currentPeriodEnd: new Date(NOW.getTime() - DAY) }),
      ]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("PURCHASE_BLOCKED_UNTIL_PERIOD_END");
      expect(mockSessionsCreate).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it("nowszy canceled po okresie + starszy canceled w okresie z prawdziwą subskrypcją: sesja Checkout (200), liczy się najnowszy wiersz", async () => {
      accessQueue.push([
        accessRow({ id: "sub-new", createdAt: new Date("2026-10-01T10:00:00.000Z"), currentPeriodEnd: new Date(NOW.getTime() - DAY) }),
        accessRow({ id: "sub-old", createdAt: new Date("2026-08-01T10:00:00.000Z"), currentPeriodEnd: new Date(NOW.getTime() + DAY) }),
      ]);
      await expectCheckoutCreated();
    });

    it("wiersz bieżący trialing bez prawdziwego Stripe + starszy canceled w okresie z prawdziwą subskrypcją: sesja Checkout (200), liczy się wiersz bieżący", async () => {
      const trial = subscriptionRow({
        id: "sub-trial",
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: new Date(NOW.getTime() + 10 * DAY),
        createdAt: new Date("2026-11-10T10:00:00.000Z"),
      });
      selectQueue.length = 0;
      selectQueue.push([PLAN_PRO], [trial]);
      accessQueue.push([
        { subscription: trial, plan: PLAN_BASIC },
        accessRow({ id: "sub-old", createdAt: new Date("2026-08-01T10:00:00.000Z"), currentPeriodEnd: new Date(NOW.getTime() + DAY) }),
      ]);
      await expectCheckoutCreated();
    });

    it("data w tekście odmowy w strefie Europe/Warsaw: koniec okresu 23:30 UTC daje dzień następny", async () => {
      accessQueue.push([accessRow({ currentPeriodEnd: new Date("2026-12-01T23:30:00.000Z") })]);

      const res = await POST(checkoutRequest("pro"));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.until).toBe("2026-12-01T23:30:00.000Z");
      expect(body.error).toBe(
        "Subskrypcja jest anulowana, ale dostęp trwa do 02.12.2026. Nowy zakup będzie możliwy po tym terminie.",
      );
    });

    it("błąd odczytu wszystkich wierszy subskrypcji: 500, bez sesji Stripe i zapisów", async () => {
      accessQueue.push(new Error("connection reset"));

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(500);
      expect(mockSessionsCreate).not.toHaveBeenCalled();
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
      expect(params.customer_email).toBe("wlasciciel@example.com");
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

  describe("(d) kontrakt wejścia z UI", () => {
    it("body z UI { planSlug } przechodzi walidację (nie 400)", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_PRO], []);

      const res = await POST(checkoutRequest("pro"));

      expect(res.status).toBe(200);
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
      expectNoWrites();
    });

    it("zmiana planu z panelu { planSlug: 'basic' } przechodzi walidację", async () => {
      selectQueue.push([PLAN_BASIC], [subscriptionRow({ planId: PLAN_PRO.id })]);

      const res = await POST(checkoutRequest("basic"));
      const body = await res.json();

      // Bez Stripe: 503 STRIPE_UNAVAILABLE, a nie 400 ze schematu.
      expect(res.status).toBe(503);
      expect(body.code).toBe("STRIPE_UNAVAILABLE");
      expectNoWrites();
    });

    it("salonId z body jest ignorowany — metadata sesji Stripe z salonu z sesji", async () => {
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_PRO], []);

      const res = await POST(rawCheckoutRequest({ planSlug: "pro", salonId: "cudzy-salon" }));

      expect(res.status).toBe(200);
      const params = mockSessionsCreate.mock.calls[0]![0];
      expect(params.metadata.salonId).toBe("salon-1");
      expectNoWrites();
    });

    it("400 bez planSlug, z polem planSlug w details, bez zapytania do bazy", async () => {
      selectQueue.push([PLAN_PRO], []);

      const res = await POST(rawCheckoutRequest({}));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.details.planSlug).toBeDefined();
      expect(selectQueue).toHaveLength(2);
      expectNoWrites();
    });

    it.each([["enterprise"], ["PRO"], [""], [123], [null]])(
      "400 przy planSlug = %j",
      async (planSlug) => {
        const res = await POST(rawCheckoutRequest({ planSlug }));
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.details.planSlug).toBeDefined();
        expect(mockSessionsCreate).not.toHaveBeenCalled();
        expectNoWrites();
      },
    );

    it("400 przy body niebędącym obiektem", async () => {
      const res = await POST(rawCheckoutRequest(["pro"]));

      expect(res.status).toBe(400);
      expectNoWrites();
    });
  });

  // Trasa ustawia `expires_at` sesji Checkout na 35 minut (2100 s) po chwili
  // utworzenia sesji; `expires_at` to czas uniksowy w sekundach.
  describe("(g) czas życia sesji Checkout", () => {
    // 2026-11-19T10:00:00.000Z = 1795082400 s
    const NOW = new Date("2026-11-19T10:00:00.000Z");
    const NOW_SECONDS = 1795082400;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
      mockGetStripe.mockReturnValue(stripeClient());
      selectQueue.push([PLAN_BASIC], []);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    async function createdSessionParams() {
      const res = await POST(checkoutRequest("basic"));
      expect(res.status).toBe(200);
      expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
      return mockSessionsCreate.mock.calls[0]![0];
    }

    it("expires_at = sekunda chwili utworzenia + 2100 (1795084500 dla 2026-11-19T10:00:00.000Z)", async () => {
      const params = await createdSessionParams();

      expect(params.expires_at).toBe(1795084500);
    });

    it("chwila z ułamkiem sekundy (10:00:59.789Z): expires_at jest liczbą całkowitą = sekunda zaokrąglona w dół + 2100", async () => {
      vi.setSystemTime(new Date("2026-11-19T10:00:59.789Z"));

      const params = await createdSessionParams();

      expect(Number.isInteger(params.expires_at)).toBe(true);
      expect(params.expires_at).toBe(1795084559);
    });

    it("expires_at minus sekunda chwili utworzenia mieści się ściśle między 1800 a 86400", async () => {
      const params = await createdSessionParams();
      const ttl = params.expires_at - NOW_SECONDS;

      expect(ttl).toBeGreaterThan(1800);
      expect(ttl).toBeLessThan(86400);
    });

    it("mode, line_items, success_url, cancel_url, customer_email i metadata sesji mają dotychczasowe wartości", async () => {
      const params = await createdSessionParams();

      expect(params.mode).toBe("subscription");
      expect(params.line_items).toEqual([
        {
          price_data: {
            currency: "pln",
            product_data: {
              name: "MyHelper Basic",
              description: "Subskrypcja miesięczna planu Basic",
            },
            unit_amount: 4900,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ]);
      expect(params.success_url).toBe(
        "https://app.example.test/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}",
      );
      expect(params.cancel_url).toBe("https://app.example.test/pricing");
      expect(params.customer_email).toBe("wlasciciel@example.com");
      expect(params.metadata).toEqual({
        salonId: "salon-1",
        planId: PLAN_BASIC.id,
        planSlug: PLAN_BASIC.slug,
        userId: "user-1",
      });
    });
  });

  // Identyfikatory cen Stripe z konfiguracji: `isStripePricesConfigured` (atrapa
  // modułu Stripe) zwraca true, a identyfikator planu trasa czyta ze zmiennych
  // STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO (ustawione na czas przypadku).
  describe("(h) cena z konfiguracji Stripe", () => {
    const NOW = new Date("2026-11-19T10:00:00.000Z");
    const EXPIRES_AT = 1795084500;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
      vi.stubEnv("STRIPE_PRICE_BASIC", "price_test_basic");
      vi.stubEnv("STRIPE_PRICE_PRO", "price_test_pro");
      mockGetStripe.mockReturnValue(stripeClient());
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    // Ta sama trasa dwa razy: z ceną z konfiguracji i z ceną tworzoną z planu.
    async function sessionParamsWithAndWithoutConfiguredPrice(plan: typeof PLAN_BASIC, slug: "basic" | "pro") {
      mockIsStripePricesConfigured.mockReturnValue(true);
      selectQueue.push([plan], []);
      expect((await POST(checkoutRequest(slug))).status).toBe(200);

      mockIsStripePricesConfigured.mockReturnValue(false);
      selectQueue.push([plan], []);
      expect((await POST(checkoutRequest(slug))).status).toBe(200);

      expect(mockSessionsCreate).toHaveBeenCalledTimes(2);
      return {
        configured: mockSessionsCreate.mock.calls[0]![0],
        adHoc: mockSessionsCreate.mock.calls[1]![0],
      };
    }

    function expectSharedParams(params: Record<string, unknown>, plan: typeof PLAN_BASIC) {
      expect(params.mode).toBe("subscription");
      expect(params.success_url).toBe(
        "https://app.example.test/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}",
      );
      expect(params.cancel_url).toBe("https://app.example.test/pricing");
      expect(params.customer_email).toBe("wlasciciel@example.com");
      expect(params.metadata).toEqual({
        salonId: "salon-1",
        planId: plan.id,
        planSlug: plan.slug,
        userId: "user-1",
      });
      expect(Number.isInteger(params.expires_at)).toBe(true);
      expect(params.expires_at).toBe(EXPIRES_AT);
    }

    it.each([
      ["basic", PLAN_BASIC, "price_test_basic"],
      ["pro", PLAN_PRO, "price_test_pro"],
    ] as const)(
      "plan %s: line_items = [{ price: identyfikator ceny planu z konfiguracji, quantity: 1 }] bez price_data; mode, success_url, cancel_url, customer_email, metadata i expires_at takie jak przy cenie tworzonej z planu",
      async (slug, plan, priceId) => {
        const { configured, adHoc } = await sessionParamsWithAndWithoutConfiguredPrice(plan, slug);

        expect(configured.line_items).toEqual([{ price: priceId, quantity: 1 }]);
        expect(configured.line_items[0]).not.toHaveProperty("price_data");
        expect(adHoc.line_items[0]).toHaveProperty("price_data");
        expect(adHoc.line_items[0]).not.toHaveProperty("price");

        expectSharedParams(configured, plan);
        expectSharedParams(adHoc, plan);
      },
    );
  });
});

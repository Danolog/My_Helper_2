/**
 * POST /api/subscriptions/cancel — anulowanie tylko potwierdzone przez Stripe
 * (T3b; warunek z przeglądu #62 §2b, przed pierwszym płacącym salonem).
 *
 * Przed poprawką trasa przy błędzie Stripe zapisywała lokalnie `canceled`
 * („Continue with local DB update even if Stripe fails”): Stripe dalej
 * pobierał opłaty, a salon tracił plan na zawsze (`canceled` końcowe).
 *
 * Kontrakt:
 * - prawdziwa subskrypcja Stripe: `cancel_at_period_end: true` (z rozwiniętym
 *   `latest_invoice`) w Stripe pod blokadą stripe_sub, potem blokada salonu
 *   i zapis `canceled` — tylko gdy odpowiedź Stripe potwierdza anulowanie;
 *   okres subskrypcji Stripe tylko w logu,
 * - `latest_invoice` opłacona (`status: "paid"`) z linią o dodatniej długości
 *   okresu → zapis dostaje też pola okresu z wartością
 *   `paidPeriodStartSql(okres)` / `paidPeriodEndSql(okres)`, okres z
 *   `paidInvoicePeriod(faktura)` (moduł atrapowany: atrapa zwraca znacznik
 *   z okresem, z którym ją wywołano); faktura nieopłacona, nierozwinięta
 *   albo bez takiej linii → zapis bez pól okresu,
 * - błąd Stripe albo brak potwierdzenia → 502, zero zapisów,
 * - Stripe nieskonfigurowany przy prawdziwej subskrypcji → 503, zero zapisów,
 * - bez prawdziwej subskrypcji (null, `sim_*`) → tylko blokada salonu, zapis lokalny,
 * - wiersz zmieniony pod blokadą → 409, zakleszczenie / lock_timeout → 503,
 * - odczyt przed blokadą i transakcja blokad przez `forSalon(salonId z sesji).raw`
 *   (prawdziwe repozytorium na atrapie `db`): każda transakcja zaczyna się od
 *   kontekstu salonu (`set local role`, `set_config` = dwa `execute`), każde
 *   zapytanie ma jawne `eq(salonId)`.
 */
import { NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/subscriptions/cancel/route";
import { logger } from "@/lib/logger";
import { STRIPE_LOCKED_READ_OPTIONS } from "@/lib/subscription-locks";
import type { SQL } from "drizzle-orm";

const f = await vi.hoisted(async () =>
  (await import("./subscription-db-fake")).createSubscriptionDbFake()
);

const { mockRequireAuth, mockGetUserSalonId, mockGetStripe, mockUpdate } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: f.db }));
// Prawdziwe `forSalon` (transakcja na atrapie `db`), opakowane szpiegami: widać salonId i użycie `raw`.
const { forSalonSpy, rawSpy } = vi.hoisted(() => ({ forSalonSpy: vi.fn(), rawSpy: vi.fn() }));
vi.mock("@/lib/server/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/repository")>();
  return {
    ...actual,
    forSalon: (salonId: string) => {
      forSalonSpy(salonId);
      const gate = actual.forSalon(salonId);
      return {
        ...gate,
        raw: ((fn) => {
          rawSpy(salonId);
          return gate.raw(fn);
        }) as typeof gate.raw,
      };
    },
  };
});
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
}));
vi.mock("@/lib/subscription-paid-period", () => {
  const marker = (fn: string) => (period: { start: Date; end: Date }) => ({
    [fn]: { start: period.start.toISOString(), end: period.end.toISOString() },
  });
  return { paidPeriodStartSql: marker("paidPeriodStartSql"), paidPeriodEndSql: marker("paidPeriodEndSql") };
});

const PERIOD_START = 1783296000;
const PERIOD_END = 1785888000;

// Okres opłaconej faktury (2026-07-01 → 2026-08-01), inny niż okres subskrypcji Stripe powyżej.
const INVOICE_START = 1782864000;
const INVOICE_END = 1785542400;
const INVOICE_PERIOD = {
  start: new Date(INVOICE_START * 1000).toISOString(),
  end: new Date(INVOICE_END * 1000).toISOString(),
};
const PAID_PERIOD_FIELDS = {
  currentPeriodStart: { paidPeriodStartSql: INVOICE_PERIOD },
  currentPeriodEnd: { paidPeriodEndSql: INVOICE_PERIOD },
};
const PAID_INVOICE = {
  id: "in_1",
  status: "paid",
  lines: { data: [{ period: { start: INVOICE_START, end: INVOICE_END } }], has_more: false },
};

const ACTIVE = {
  id: "sub-local",
  salonId: "salon-1",
  planId: "plan-pro",
  status: "active",
  stripeSubscriptionId: "sub_1",
  stripeCustomerId: "cus_1",
  trialEndsAt: null,
  currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
  canceledAt: null,
  scheduledPlanId: null,
  scheduledChangeAt: null,
};

const STRIPE_CANCELED_AT_PERIOD_END = {
  id: "sub_1",
  status: "active",
  cancel_at_period_end: true,
  items: { data: [{ current_period_start: PERIOD_START, current_period_end: PERIOD_END }] },
};

const subWrites = () => f.committed.filter((w) => w.table === "salon_subscriptions");

/** Kontekst salonu z `forSalon`: `set local role` i `set_config(app.current_salon_id)`. */
const SALON_CONTEXT = ["execute", "execute"];
/** Odczyt aktywnej subskrypcji przed blokadą: własna transakcja `forSalon`. */
const PRE_READ = [...SALON_CONTEXT, "select", "commit"];

/** Parametry filtra `.where(...)` (renderowanego przez PgDialect) kolejnych zapytań. */
const whereParams = () =>
  f.wheres.map((w) => ({ op: w.op, params: new PgDialect().sqlToQuery(w.cond as SQL).params }));

async function cancel() {
  const res = await POST();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  f.reset();
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockGetUserSalonId.mockResolvedValue("salon-1");
  mockUpdate.mockImplementation(async () => {
    f.log.push("stripe.update");
    return STRIPE_CANCELED_AT_PERIOD_END;
  });
  mockGetStripe.mockReturnValue({ subscriptions: { update: mockUpdate } });
});

describe("POST /api/subscriptions/cancel — prawdziwa subskrypcja Stripe", () => {
  it("200: Stripe potwierdza cancel_at_period_end, odpowiedź bez latest_invoice → canceled bez pól okresu (okres w wierszu bez zmian), kolejność blokad stripe_sub → Stripe → salon", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ success: true, stripeCanceled: true }));
    expect(body).not.toHaveProperty("stripeError");
    expect(mockUpdate).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true, expand: ["latest_invoice"] },
      STRIPE_LOCKED_READ_OPTIONS,
    );
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        values: expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date) }),
      }),
    ]);
    // Stripe zwraca okres inny niż zapisany w wierszu — zapis go nie przenosi.
    expect(new Date(PERIOD_END * 1000)).not.toEqual(ACTIVE.currentPeriodEnd);
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodStart");
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
    // Odpowiedź nie niesie końca okresu ze Stripe.
    expect((body.subscription as Record<string, unknown>).currentPeriodEnd).not.toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    );
    expect(f.log).toEqual([
      ...PRE_READ,
      ...SALON_CONTEXT,
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "select",
      "stripe.update",
      "lock:salon:salon-1",
      "update:salon_subscriptions",
      "commit",
    ]);
  });

  it("200: odpowiedź Stripe bez okresu → ten sam zapis canceled bez pól okresu", async () => {
    mockUpdate.mockResolvedValue({ id: "sub_1", status: "active", cancel_at_period_end: true, items: { data: [] } });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(subWrites()).toEqual([
      expect.objectContaining({
        op: "update",
        values: expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date) }),
      }),
    ]);
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodStart");
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
    expect(logger.info).toHaveBeenCalledWith("Stripe subscription set to cancel at period end", {
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
      currentPeriodEnd: null,
    });
  });

  it("log anulowania w Stripe niesie koniec okresu ze Stripe", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith("Stripe subscription set to cancel at period end", {
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
      currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    });
  });

  it("200: Stripe już canceled (bez cancel_at_period_end) → lokalne canceled", async () => {
    mockUpdate.mockResolvedValue({ ...STRIPE_CANCELED_AT_PERIOD_END, status: "canceled", cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(subWrites().map((w) => w.values.status)).toEqual(["canceled"]);
  });

  it("502: błąd Stripe → zero zapisów, bez blokady salonu", async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("card_declined: secret detail"), { type: "StripeAPIError" }));
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(502);
    expect(body.code).toBe("STRIPE_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret detail");
    expect(f.committed).toEqual([]);
    expect(f.log).not.toContain("lock:salon:salon-1");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Stripe subscription cancel failed"),
      expect.objectContaining({ stripeSubscriptionId: "sub_1" })
    );
  });

  it("502: Stripe nie potwierdza (active, cancel_at_period_end=false) → zero zapisów + manual handling", async () => {
    mockUpdate.mockResolvedValue({ ...STRIPE_CANCELED_AT_PERIOD_END, cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(502);
    expect(f.committed).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("manual handling"), expect.anything());
  });

  it("503: Stripe nieskonfigurowany przy prawdziwej subskrypcji → bez transakcji blokad i bez zapisu", async () => {
    mockGetStripe.mockReturnValue(null);
    f.selects.push([ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(503);
    expect(body.code).toBe("STRIPE_UNAVAILABLE");
    // Jedyna transakcja to odczyt przed blokadą (wykonany): bez lock_timeout i blokad.
    expect(f.state.transactions).toBe(1);
    expect(f.log).toEqual(PRE_READ);
    expect(f.selects).toHaveLength(0);
    expect(f.committed).toEqual([]);
  });

  it("409: pod blokadą stripe_sub wiersz już nie jest active (np. webhook deleted) → bez wywołania Stripe i zapisu", async () => {
    f.selects.push([ACTIVE], [{ ...ACTIVE, status: "canceled" }]);

    const { status, body } = await cancel();

    expect(status).toBe(409);
    expect(body.code).toBe("SUBSCRIPTION_CHANGED");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
    // Odmowa po faktycznym odczycie wiersza pod blokadą stripe_sub.
    expect(f.selects).toHaveLength(0);
    expect(f.log).toEqual([...PRE_READ, ...SALON_CONTEXT, "lock_timeout", "lock:stripe_sub:sub_1", "select", "commit"]);
  });

  it.each(["40P01", "55P03"])("503: %s przy blokadzie → LOCK_BUSY, bez wywołania Stripe i zapisu", async (code) => {
    f.state.failNextLock = { code };
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status, body } = await cancel();

    expect(status).toBe(503);
    expect(body.code).toBe("LOCK_BUSY");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.committed).toEqual([]);
    expect(f.log).toEqual([...PRE_READ, ...SALON_CONTEXT, "lock_timeout", "lock:stripe_sub:sub_1", "rollback"]);
  });

  it("500: błąd bazy przy zapisie → transakcja wycofana", async () => {
    f.state.failNextSubscriptionWrite = { code: "XX000" };
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(500);
    expect(f.committed).toEqual([]);
    expect(f.state.rolledBack).toBe(1);
  });
});

describe("POST /api/subscriptions/cancel — okres z latest_invoice", () => {
  function stripeReturns(latestInvoice: unknown, overrides: Record<string, unknown> = {}) {
    mockUpdate.mockImplementation(async () => {
      f.log.push("stripe.update");
      return { ...STRIPE_CANCELED_AT_PERIOD_END, latest_invoice: latestInvoice, ...overrides };
    });
  }
  const periodWrite = () => subWrites()[0]?.values;
  const paymentWrites = () => f.committed.filter((w) => w.table === "subscription_payments");

  it("Stripe dostaje cancel_at_period_end: true, expand: [\"latest_invoice\"] i opcje odczytu pod blokadą", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      "sub_1",
      { cancel_at_period_end: true, expand: ["latest_invoice"] },
      STRIPE_LOCKED_READ_OPTIONS,
    );
  });

  it("200: faktura paid z linią [start, end] → zapis canceled z paidPeriodStartSql/paidPeriodEndSql wołanymi z okresem tej linii", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(subWrites()).toHaveLength(1);
    expect(periodWrite()).toEqual(
      expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date), ...PAID_PERIOD_FIELDS }),
    );
  });

  it("200: faktura open → zapis canceled bez pól okresu", async () => {
    stripeReturns({ ...PAID_INVOICE, status: "open" });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(periodWrite()).toEqual(expect.objectContaining({ status: "canceled" }));
    expect(periodWrite()).not.toHaveProperty("currentPeriodStart");
    expect(periodWrite()).not.toHaveProperty("currentPeriodEnd");
  });

  it.each([
    ["string (nierozwinięta)", "in_1"],
    ["null", null],
  ])("200: latest_invoice = %s → zapis bez pól okresu + warn", async (_n, latestInvoice) => {
    stripeReturns(latestInvoice);
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(periodWrite()).toEqual(expect.objectContaining({ status: "canceled" }));
    expect(periodWrite()).not.toHaveProperty("currentPeriodStart");
    expect(periodWrite()).not.toHaveProperty("currentPeriodEnd");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Latest invoice not available"),
      expect.objectContaining({ subscriptionId: "sub-local", stripeSubscriptionId: "sub_1" }),
    );
  });

  it.each([
    ["bez linii", { data: [] }],
    ["tylko linia o zerowej długości okresu", { data: [{ period: { start: INVOICE_END, end: INVOICE_END } }] }],
  ])("200: faktura paid %s → zapis bez pól okresu + warn", async (_n, lines) => {
    stripeReturns({ ...PAID_INVOICE, lines });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(periodWrite()).toEqual(expect.objectContaining({ status: "canceled" }));
    expect(periodWrite()).not.toHaveProperty("currentPeriodStart");
    expect(periodWrite()).not.toHaveProperty("currentPeriodEnd");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("without a billing period"),
      expect.objectContaining({ subscriptionId: "sub-local" }),
    );
  });

  it("200: linia jednorazowa (później) + linia okresu → okres z linii okresu", async () => {
    const oneOff = INVOICE_END + 86400;
    stripeReturns({
      ...PAID_INVOICE,
      lines: {
        data: [{ period: { start: oneOff, end: oneOff } }, { period: { start: INVOICE_START, end: INVOICE_END } }],
      },
    });
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(periodWrite()).toEqual(expect.objectContaining(PAID_PERIOD_FIELDS));
  });

  it("200: Stripe canceled (bez cancel_at_period_end) + faktura paid → okres zapisany", async () => {
    stripeReturns(PAID_INVOICE, { status: "canceled", cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(periodWrite()).toEqual(expect.objectContaining({ status: "canceled", ...PAID_PERIOD_FIELDS }));
  });

  it("502: Stripe nie potwierdza anulowania przy fakturze paid → zero zapisów", async () => {
    stripeReturns(PAID_INVOICE, { cancel_at_period_end: false });
    f.selects.push([ACTIVE], [ACTIVE]);

    const { status } = await cancel();

    expect(status).toBe(502);
    expect(f.committed).toEqual([]);
  });

  it("odpowiedź oddaje currentPeriodEnd z wiersza zwróconego przez zapis (returning)", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    const { body } = await cancel();

    expect((body.subscription as Record<string, unknown>).currentPeriodEnd).toEqual(
      PAID_PERIOD_FIELDS.currentPeriodEnd,
    );
  });

  it("faktura paid → brak zapisu do subscription_payments (żadnego insertu)", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(paymentWrites()).toEqual([]);
    expect(f.log.filter((op) => op.startsWith("insert:"))).toEqual([]);
  });

  it("faktura paid → kolejność: stripe_sub → stripe.update → salon → update", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(f.log).toEqual([
      ...PRE_READ,
      ...SALON_CONTEXT,
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "select",
      "stripe.update",
      "lock:salon:salon-1",
      "update:salon_subscriptions",
      "commit",
    ]);
  });

  it("koniec opłaconego okresu późniejszy niż w wierszu pod blokadą → log info „Paid period ahead of row”", async () => {
    stripeReturns(PAID_INVOICE);
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(logger.info).toHaveBeenCalledWith("Paid period ahead of row", {
      subscriptionId: "sub-local",
      stripeSubscriptionId: "sub_1",
      paidPeriodEnd: INVOICE_PERIOD.end,
      rowPeriodEnd: ACTIVE.currentPeriodEnd.toISOString(),
    });
  });

  it("koniec opłaconego okresu równy końcowi w wierszu pod blokadą → bez logu „Paid period ahead of row”, pola okresu w zapisie", async () => {
    const row = { ...ACTIVE, currentPeriodEnd: new Date(INVOICE_END * 1000) };
    stripeReturns(PAID_INVOICE);
    f.selects.push([row], [row]);

    await cancel();

    expect(logger.info).not.toHaveBeenCalledWith("Paid period ahead of row", expect.anything());
    expect(periodWrite()).toEqual(expect.objectContaining(PAID_PERIOD_FIELDS));
  });

  it("faktura paid z lines.has_more → warn, okres z obecnych linii", async () => {
    stripeReturns({ ...PAID_INVOICE, lines: { ...PAID_INVOICE.lines, has_more: true } });
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("line list incomplete"),
      expect.objectContaining({ subscriptionId: "sub-local", linesHasMore: true }),
    );
    expect(periodWrite()).toEqual(expect.objectContaining(PAID_PERIOD_FIELDS));
  });

  it.each([
    ["null", null],
    ["sim_*", "sim_sub_1"],
  ])("stripeSubscriptionId = %s → zapis bez obu pól okresu, Stripe nie wołany", async (_n, id) => {
    const row = { ...ACTIVE, stripeSubscriptionId: id };
    f.selects.push([row], [row]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(mockGetStripe).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(periodWrite()).toEqual(expect.objectContaining({ status: "canceled" }));
    expect(periodWrite()).not.toHaveProperty("currentPeriodStart");
    expect(periodWrite()).not.toHaveProperty("currentPeriodEnd");
    expect(paymentWrites()).toEqual([]);
  });
});

describe("POST /api/subscriptions/cancel — bez prawdziwej subskrypcji Stripe", () => {
  it.each([
    ["null", null],
    ["sim_*", "sim_sub_1"],
  ])("stripeSubscriptionId = %s → bez Stripe, blokada salonu, lokalne canceled", async (_n, id) => {
    const row = { ...ACTIVE, stripeSubscriptionId: id };
    f.selects.push([row], [row]);

    const { status, body } = await cancel();

    expect(status).toBe(200);
    expect(body.stripeCanceled).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(f.log).toEqual([
      ...PRE_READ,
      ...SALON_CONTEXT,
      "lock_timeout",
      "lock:salon:salon-1",
      "select",
      "update:salon_subscriptions",
      "commit",
    ]);
    expect(subWrites()[0]?.values).toEqual(expect.objectContaining({ status: "canceled" }));
    // Zapis nie zawiera pól okresu — tak samo jak ze Stripe.
    expect(subWrites()[0]?.values).not.toHaveProperty("currentPeriodEnd");
  });

  it("409: pod blokadą salonu wiersz już nie jest active → bez zapisu", async () => {
    const row = { ...ACTIVE, stripeSubscriptionId: null };
    f.selects.push([row], [{ ...row, status: "canceled" }]);

    const { status } = await cancel();

    expect(status).toBe(409);
    expect(f.committed).toEqual([]);
    // Odmowa po faktycznym odczycie wiersza pod blokadą salonu.
    expect(f.selects).toHaveLength(0);
    expect(f.log).toEqual([...PRE_READ, ...SALON_CONTEXT, "lock_timeout", "lock:salon:salon-1", "select", "commit"]);
  });
});

describe("POST /api/subscriptions/cancel — wejście", () => {
  it("401 bez sesji", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await cancel()).status).toBe(401);
    expect(f.log).toEqual([]);
  });

  it("404 bez salonu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect((await cancel()).status).toBe(404);
  });

  it("404 bez aktywnej subskrypcji", async () => {
    f.selects.push([]);
    expect((await cancel()).status).toBe(404);
    // Odczyt wykonany (forSalon salonu z sesji), bez transakcji blokad.
    expect(forSalonSpy.mock.calls).toEqual([["salon-1"]]);
    expect(f.state.transactions).toBe(1);
    expect(f.log).toEqual(PRE_READ);
  });
});

describe("POST /api/subscriptions/cancel — forSalon salonu z sesji", () => {
  it("forSalon i oba raw (odczyt i transakcja blokad) z salonId z sesji; blokada salonu na tym salonie", async () => {
    mockGetUserSalonId.mockResolvedValue("salon-session");
    f.selects.push([{ ...ACTIVE, salonId: "salon-session" }], [{ ...ACTIVE, salonId: "salon-session" }]);

    const { status } = await cancel();

    expect(status).toBe(200);
    expect(forSalonSpy.mock.calls).toEqual([["salon-session"]]);
    expect(rawSpy.mock.calls).toEqual([["salon-session"], ["salon-session"]]);
    expect(f.log).toContain("lock:salon:salon-session");
  });

  it("kolejność: kontekst salonu → lock_timeout → stripe_sub → Stripe → salon → zapis", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    const lockTx = f.log.slice(PRE_READ.length);
    expect(lockTx).toEqual([
      "execute",
      "execute",
      "lock_timeout",
      "lock:stripe_sub:sub_1",
      "select",
      "stripe.update",
      "lock:salon:salon-1",
      "update:salon_subscriptions",
      "commit",
    ]);
  });

  it("każde zapytanie ma jawny filtr salonu; zapis po id ORAZ salonId", async () => {
    f.selects.push([ACTIVE], [ACTIVE]);

    await cancel();

    expect(whereParams()).toEqual([
      { op: "select", params: ["salon-1", "active"] },
      { op: "select", params: ["sub-local", "salon-1"] },
      { op: "update", params: ["sub-local", "salon-1"] },
    ]);
  });

  it("bez prawdziwej subskrypcji Stripe: odczyt pod blokadą salonu i zapis też z filtrem salonu", async () => {
    const row = { ...ACTIVE, stripeSubscriptionId: null };
    f.selects.push([row], [row]);

    await cancel();

    expect(whereParams()).toEqual([
      { op: "select", params: ["salon-1", "active"] },
      { op: "select", params: ["sub-local", "salon-1"] },
      { op: "update", params: ["sub-local", "salon-1"] },
    ]);
  });

  it("55P03 przy blokadzie salonu (bez Stripe) → 503 LOCK_BUSY, bez zapisu, rollback", async () => {
    const row = { ...ACTIVE, stripeSubscriptionId: null };
    f.state.failNextLock = { code: "55P03" };
    f.selects.push([row], [row]);

    const { status, body } = await cancel();

    expect(status).toBe(503);
    expect(body.code).toBe("LOCK_BUSY");
    expect(f.committed).toEqual([]);
    expect(f.log).toEqual([...PRE_READ, ...SALON_CONTEXT, "lock_timeout", "lock:salon:salon-1", "rollback"]);
  });
});

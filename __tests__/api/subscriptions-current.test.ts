/**
 * GET /api/subscriptions/current — karta planu w panelu.
 *
 * - Listy funkcji z kodu (`src/lib/plan-features.ts`), nie z kolumny
 *   `features_json`: stare wiersze w bazie obiecują wyłączone funkcje (B9).
 * - Jeden odczyt przez repozytorium salonu: wszystkie wiersze subskrypcji
 *   salonu; karta pokazuje wiersz wybrany przez `pickSalonAccessRow`,
 *   a `access` i `effectivePlanSlug` liczy `resolveSalonAccess` na tych
 *   samych wierszach (ta sama reguła co bramki serwerowe).
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/subscriptions/current/route";
import { logger } from "@/lib/logger";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { getCurrentPlan } from "@/lib/subscription";
import type { SQL } from "drizzle-orm";

const { queue, log, mockForSalon, mockRequireAuth, mockIsAuthError, mockGetUserSalonId } = vi.hoisted(() => ({
  // Kolejne zapytania `tx.select()` zdejmują wyniki z kolejki (FIFO);
  // Error w kolejce = odrzucone zapytanie.
  queue: [] as (unknown[] | Error)[],
  // Warunki `where` i klucze `orderBy` (wyrenderowane) oraz argumenty `limit`
  // kolejnych zapytań.
  log: {
    where: [] as { sql: string; params: unknown[] }[],
    orderBy: [] as string[][],
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

// Szpieg: trasa nie liczy planu przez `getCurrentPlan`.
vi.mock("@/lib/subscription", () => ({
  getCurrentPlan: vi.fn(async () => ({ slug: "basic", name: "Basic", status: "none" })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const dialect = new PgDialect();

/**
 * Atrapa zapytania. Honoruje `limit` i filtr `status in (…)` w `where`, żeby
 * zawężenie odczytu w trasie było widoczne w wyniku tak jak w bazie.
 */
function chain() {
  let where: SQL | undefined;
  let limit: number | undefined;
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin"]) builder[method] = () => builder;
  builder.orderBy = (...keys: SQL[]) => {
    log.orderBy.push(keys.map((k) => dialect.sqlToQuery(k).sql));
    return builder;
  };
  builder.where = (cond: SQL) => {
    where = cond;
    const q = dialect.sqlToQuery(cond);
    log.where.push({ sql: q.sql, params: q.params });
    return builder;
  };
  builder.limit = (n: number) => {
    limit = n;
    log.limit.push(n);
    return builder;
  };
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => {
    const next = queue.shift() ?? [];
    if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
    let rows = next;
    if (where) {
      const q = dialect.sqlToQuery(where);
      if (q.sql.includes('"salon_subscriptions"."status" in')) {
        rows = rows.filter((r) => q.params.includes((r as { subscription: { status: string } }).subscription.status));
      }
    }
    if (limit !== undefined) rows = rows.slice(0, limit);
    return Promise.resolve(rows).then(resolve, reject);
  };
  return builder;
}

const txSelect = vi.fn(() => chain());
const tx = { select: txSelect };

const NOW = new Date("2026-11-19T10:00:00.000Z");
const DAY = 86_400_000;
const ERROR_BODY = { success: false, error: "Nie udalo sie pobrac subskrypcji" };

// Brzmienie wierszy założonych przez kod sprzed B9.
const STALE = [
  "Asystent AI glosowy (odbieranie polaczen)",
  "Platnosci zadatkow (Stripe + Blik)",
  "Integracja z drukarka fiskalna",
];
const STALE_WORDS = /glosowy|Stripe \+ Blik|drukarka fiskalna/;

function planRow(slug: string, featuresJson: unknown = null) {
  return {
    id: `plan-${slug}`,
    name: slug,
    slug,
    priceMonthly: slug === "pro" ? "149.00" : "49.00",
    featuresJson,
    isActive: true,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    salonId: "salon-1",
    planId: "plan-pro",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}, slug = "pro", featuresJson: unknown = null) {
  return { subscription: subscriptionRow(overrides), plan: planRow(slug, featuresJson) };
}

const OLDER = new Date("2026-11-01T00:00:00.000Z");
const NEWER = new Date("2026-11-10T00:00:00.000Z");

async function body() {
  const res = await GET();
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  queue.length = 0;
  log.where.length = 0;
  log.orderBy.length = 0;
  log.limit.length = 0;
  txSelect.mockClear();
  vi.mocked(getCurrentPlan).mockClear();
  vi.mocked(logger.error).mockClear();
  mockForSalon.mockReset().mockImplementation((salonId: string) => ({
    salonId,
    raw: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }));
  mockRequireAuth.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  mockIsAuthError.mockReset().mockReturnValue(false);
  mockGetUserSalonId.mockReset().mockResolvedValue("salon-1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/subscriptions/current — listy funkcji z kodu", () => {
  it("plan: zwraca listę z PLAN_FEATURES, ignorując nieaktualne features_json w bazie", async () => {
    queue.push([row({}, "pro", STALE)]);
    const b = await body();
    expect(b.plan.features).toEqual([...PLAN_FEATURES.pro]);
    expect(JSON.stringify(b)).not.toMatch(STALE_WORDS);
  });

  it("scheduledPlan: zaplanowany plan docelowy też dostaje listę z kodu", async () => {
    queue.push([row({ scheduledPlanId: "plan-basic" }, "pro", STALE)], [planRow("basic", STALE)]);
    const b = await body();
    expect(b.scheduledPlan.slug).toBe("basic");
    expect(b.scheduledPlan.features).toEqual([...PLAN_FEATURES.basic]);
    expect(JSON.stringify(b)).not.toMatch(STALE_WORDS);
  });

  it("plan spoza PLAN_FEATURES zachowuje listę z bazy", async () => {
    queue.push([row({ planId: "plan-enterprise" }, "enterprise", ["Dedykowany opiekun"])]);
    expect((await body()).plan.features).toEqual(["Dedykowany opiekun"]);
  });

  it("plan spoza PLAN_FEATURES bez listy w bazie dostaje pustą tablicę", async () => {
    queue.push([row({ planId: "plan-enterprise" }, "enterprise", null)]);
    expect((await body()).plan.features).toEqual([]);
  });
});

describe("GET /api/subscriptions/current — sesja i błędy", () => {
  it("brak sesji -> 401 bez odczytu przez repozytorium salonu", async () => {
    mockRequireAuth.mockResolvedValue(Response.json({ success: false, error: "Unauthorized" }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);
    expect((await GET()).status).toBe(401);
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("użytkownik bez salonu -> 404 bez odczytu przez repozytorium salonu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(mockForSalon).not.toHaveBeenCalled();
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("błąd odczytu (raw odrzucone) -> 500 ze stałą treścią, wpis w logu", async () => {
    mockForSalon.mockImplementation((salonId: string) => ({
      salonId,
      raw: () => Promise.reject(new Error("db down")),
    }));
    const res = await GET();
    expect(res.status).toBe(500);
    const b = await res.json();
    expect(b).toEqual(ERROR_BODY);
    expect(JSON.stringify(b)).not.toContain("db down");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("błąd zapytania o wiersze subskrypcji -> 500 (bez awaryjnego basic)", async () => {
    queue.push(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(ERROR_BODY);
  });

  it("błąd odczytu planu docelowego -> 500", async () => {
    queue.push([row({ scheduledPlanId: "plan-basic" })], new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(ERROR_BODY);
  });
});

describe("GET /api/subscriptions/current — jeden odczyt przez repozytorium salonu", () => {
  it("forSalon raz, z salonem z sesji; getCurrentPlan nie jest wołany", async () => {
    queue.push([row()]);
    await body();
    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith("salon-1");
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("brak wiersza: forSalon z salonem z sesji, getCurrentPlan nie jest wołany", async () => {
    await body();
    expect(mockForSalon).toHaveBeenCalledWith("salon-1");
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("zapytanie: jawny warunek salonu, bez filtra statusu i bez limitu", async () => {
    queue.push([row()]);
    await body();
    expect(txSelect).toHaveBeenCalledTimes(1);
    expect(log.where).toEqual([{ sql: '"salon_subscriptions"."salon_id" = $1', params: ["salon-1"] }]);
    expect(log.limit).toEqual([]);
  });

  it("zapytanie: sortuje po created_at malejąco, potem po id malejąco", async () => {
    queue.push([row()]);
    await body();
    expect(log.orderBy).toEqual([
      ['"salon_subscriptions"."created_at" desc', '"salon_subscriptions"."id" desc'],
    ]);
  });
});

describe("GET /api/subscriptions/current — wiersz karty i access", () => {
  it("brak wierszy -> subscription/plan null, basic, access none/read_only", async () => {
    expect(await body()).toEqual({
      success: true,
      subscription: null,
      plan: null,
      effectivePlanSlug: "basic",
      access: { state: "none", mode: "read_only", planSlug: null, until: null },
    });
  });

  it("trialing Pro w terminie -> pełny dostęp do trialEndsAt, pro", async () => {
    const ends = new Date(NOW.getTime() + 3 * DAY);
    queue.push([row({ status: "trialing", trialEndsAt: ends })]);
    const b = await body();
    expect(b.effectivePlanSlug).toBe("pro");
    expect(b.access).toEqual({ state: "trialing", mode: "full", planSlug: "pro", until: ends.toISOString() });
  });

  it("trialing Pro po terminie -> expired, basic; karta nadal trialing/Pro", async () => {
    queue.push([row({ status: "trialing", trialEndsAt: new Date(NOW.getTime() - DAY) })]);
    const b = await body();
    expect(b.subscription.status).toBe("trialing");
    expect(b.plan.slug).toBe("pro");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "expired", mode: "read_only", planSlug: null, until: null });
  });

  it("trialing Pro bez daty końca -> expired, basic", async () => {
    queue.push([row({ status: "trialing" })]);
    const b = await body();
    expect(b.subscription.status).toBe("trialing");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "expired", mode: "read_only", planSlug: null, until: null });
  });

  it("active Pro z końcem okresu -> pełny dostęp, until = currentPeriodEnd", async () => {
    const end = new Date(NOW.getTime() + 20 * DAY);
    queue.push([row({ currentPeriodEnd: end })]);
    const b = await body();
    expect(b.effectivePlanSlug).toBe("pro");
    expect(b.access).toEqual({ state: "active", mode: "full", planSlug: "pro", until: end.toISOString() });
  });

  it("active Pro bez końca okresu -> pełny dostęp, until null; active Basic -> basic", async () => {
    queue.push([row()]);
    const b = await body();
    expect(b.effectivePlanSlug).toBe("pro");
    expect(b.access).toEqual({ state: "active", mode: "full", planSlug: "pro", until: null });

    queue.push([row({ planId: "plan-basic" }, "basic")]);
    const basic = await body();
    expect(basic.effectivePlanSlug).toBe("basic");
    expect(basic.access).toEqual({ state: "active", mode: "full", planSlug: "basic", until: null });
  });

  it("past_due w łasce -> karta past_due, pełny dostęp do start + 7 dni, plan wiersza", async () => {
    const start = new Date(NOW.getTime() - 2 * DAY);
    queue.push([row({ status: "past_due", currentPeriodStart: start })]);
    const b = await body();
    expect(b.subscription.status).toBe("past_due");
    expect(b.plan.slug).toBe("pro");
    expect(b.effectivePlanSlug).toBe("pro");
    expect(b.access).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(start.getTime() + 7 * DAY).toISOString(),
    });
  });

  it("past_due po łasce -> karta past_due, tylko odczyt, basic", async () => {
    queue.push([row({ status: "past_due", currentPeriodStart: new Date(NOW.getTime() - 8 * DAY) })]);
    const b = await body();
    expect(b.subscription.status).toBe("past_due");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "past_due", mode: "read_only", planSlug: null, until: null });
  });

  it("past_due bez currentPeriodStart -> karta past_due, tylko odczyt, basic", async () => {
    queue.push([row({ status: "past_due" })]);
    const b = await body();
    expect(b.subscription.status).toBe("past_due");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "past_due", mode: "read_only", planSlug: null, until: null });
  });

  it("sam canceled Pro -> karta canceled/Pro, tylko odczyt, basic", async () => {
    queue.push([row({ status: "canceled", canceledAt: new Date(NOW.getTime() - DAY) })]);
    const b = await body();
    expect(b.subscription.status).toBe("canceled");
    expect(b.plan.slug).toBe("pro");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "canceled", mode: "read_only", planSlug: null, until: null });
  });

  it.each([
    ["najnowszy pierwszy", "newest-first"],
    ["najstarszy pierwszy", "oldest-first"],
  ])("starszy active + nowszy canceled (%s) -> karta active, pełny dostęp", async (_n, order) => {
    const active = row({ id: "sub-active", createdAt: OLDER });
    const canceled = row({ id: "sub-canceled", status: "canceled", createdAt: NEWER });
    queue.push(order === "newest-first" ? [canceled, active] : [active, canceled]);
    const b = await body();
    expect(b.subscription.id).toBe("sub-active");
    expect(b.subscription.status).toBe("active");
    expect(b.effectivePlanSlug).toBe("pro");
    expect(b.access).toEqual({ state: "active", mode: "full", planSlug: "pro", until: null });
  });

  it("starszy canceled + nowszy past_due -> karta past_due", async () => {
    const start = new Date(NOW.getTime() - DAY);
    queue.push([
      row({ id: "sub-past-due", status: "past_due", currentPeriodStart: start, createdAt: NEWER }),
      row({ id: "sub-canceled", status: "canceled", createdAt: OLDER }),
    ]);
    const b = await body();
    expect(b.subscription.id).toBe("sub-past-due");
    expect(b.access).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(start.getTime() + 7 * DAY).toISOString(),
    });
  });

  it("starszy canceled + nowszy incomplete -> karta incomplete, inactive", async () => {
    queue.push([
      row({ id: "sub-incomplete", status: "incomplete", createdAt: NEWER }),
      row({ id: "sub-canceled", status: "canceled", createdAt: OLDER }),
    ]);
    const b = await body();
    expect(b.subscription.id).toBe("sub-incomplete");
    expect(b.subscription.status).toBe("incomplete");
    expect(b.effectivePlanSlug).toBe("basic");
    expect(b.access).toEqual({ state: "inactive", mode: "read_only", planSlug: null, until: null });
  });

  it.each([
    ["canceled pierwszy", "canceled-first"],
    ["incomplete pierwszy", "incomplete-first"],
  ])("canceled + incomplete o tym samym createdAt (%s) -> karta i access z pierwszego wiersza zapytania", async (_n, order) => {
    const canceled = row({ id: "sub-canceled", status: "canceled", createdAt: NEWER });
    const incomplete = row({ id: "sub-incomplete", status: "incomplete", createdAt: NEWER });
    queue.push(order === "canceled-first" ? [canceled, incomplete] : [incomplete, canceled]);
    const b = await body();
    if (order === "canceled-first") {
      expect(b.subscription.id).toBe("sub-canceled");
      expect(b.subscription.status).toBe("canceled");
      expect(b.access.state).toBe("canceled");
    } else {
      expect(b.subscription.id).toBe("sub-incomplete");
      expect(b.subscription.status).toBe("incomplete");
      expect(b.access.state).toBe("inactive");
    }
  });
});

describe("GET /api/subscriptions/current — scheduledPlan z wybranego wiersza", () => {
  it("wybrany wiersz z scheduledPlanId -> plan docelowy z listą z kodu, drugi odczyt w tym samym raw", async () => {
    queue.push([row({ scheduledPlanId: "plan-basic" })], [planRow("basic")]);
    const b = await body();
    expect(b.scheduledPlan).toEqual({
      id: "plan-basic",
      name: "basic",
      slug: "basic",
      priceMonthly: "49.00",
      features: [...PLAN_FEATURES.basic],
    });
    expect(txSelect).toHaveBeenCalledTimes(2);
    expect(log.where[1]).toEqual({ sql: '"subscription_plans"."id" = $1', params: ["plan-basic"] });
    expect(mockForSalon).toHaveBeenCalledTimes(1);
  });

  it("brak planu docelowego -> scheduledPlan null", async () => {
    queue.push([row({ scheduledPlanId: "plan-missing" })], []);
    expect((await body()).scheduledPlan).toBeNull();
    expect(txSelect).toHaveBeenCalledTimes(2);
  });

  it("scheduledPlanId na wierszu niewybranym -> bez drugiego odczytu, scheduledPlan null", async () => {
    queue.push(
      [
        row({ id: "sub-canceled", status: "canceled", scheduledPlanId: "plan-basic", createdAt: NEWER }),
        row({ id: "sub-active", createdAt: OLDER }),
      ],
      [planRow("basic")],
    );
    const b = await body();
    expect(b.subscription.id).toBe("sub-active");
    expect(b.scheduledPlan).toBeNull();
    expect(txSelect).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/subscriptions/current — kształt odpowiedzi", () => {
  it("klucze dokładnie dotychczasowe + access; until jako ISO", async () => {
    const end = new Date(NOW.getTime() + 20 * DAY);
    queue.push([row({ currentPeriodEnd: end })]);
    const b = await body();
    expect(Object.keys(b).sort()).toEqual(
      ["access", "effectivePlanSlug", "plan", "scheduledPlan", "subscription", "success"].sort(),
    );
    expect(Object.keys(b.subscription).sort()).toEqual(Object.keys(subscriptionRow()).sort());
    expect(Object.keys(b.plan).sort()).toEqual(["features", "id", "isActive", "name", "priceMonthly", "slug"]);
    expect(Object.keys(b.access).sort()).toEqual(["mode", "planSlug", "state", "until"]);
    expect(b.access.until).toBe("2026-12-09T10:00:00.000Z");
  });

  it("brak wiersza: bez klucza scheduledPlan", async () => {
    const b = await body();
    expect(Object.keys(b).sort()).toEqual(["access", "effectivePlanSlug", "plan", "subscription", "success"]);
  });
});

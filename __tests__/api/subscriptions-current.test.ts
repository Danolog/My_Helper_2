/**
 * GET /api/subscriptions/current — karta planu w panelu („Funkcje w Twoim
 * planie”) dostaje listy funkcji z kodu (`src/lib/plan-features.ts`), nie z
 * kolumny `features_json`. Stare wiersze w bazie obiecują wyłączone funkcje
 * (B9): asystenta głosowego, zadatki przez Stripe + Blik, drukarkę fiskalną.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/current/route";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { getCurrentPlan } from "@/lib/subscription";

const { queue, mockRequireAuth, mockIsAuthError, mockGetUserSalonId } = vi.hoisted(() => ({
  // Kolejne zapytania `db.select()` zdejmują wyniki z kolejki (FIFO);
  // Error w kolejce = odrzucone zapytanie.
  queue: [] as (unknown[] | Error)[],
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const chain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      const next = queue.shift() ?? [];
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)).then(resolve, reject);
    };
    return builder;
  };
  return { db: { select: vi.fn(() => chain()) } };
});

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));

// Prawdziwe getCurrentPlan (ta sama funkcja co bramki serwerowe), owinięte
// w szpiega tylko po to, by sprawdzić salon, dla którego liczy plan.
vi.mock("@/lib/subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription")>();
  return { ...actual, getCurrentPlan: vi.fn(actual.getCurrentPlan) };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Brzmienie wierszy założonych przez kod sprzed B9.
const STALE = [
  "Asystent AI glosowy (odbieranie polaczen)",
  "Platnosci zadatkow (Stripe + Blik)",
  "Integracja z drukarka fiskalna",
];
const STALE_WORDS = /glosowy|Stripe \+ Blik|drukarka fiskalna/;

function planRow(slug: string, featuresJson: unknown) {
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
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("GET /api/subscriptions/current", () => {
  beforeEach(() => {
    queue.length = 0;
    mockRequireAuth.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    mockIsAuthError.mockReset().mockReturnValue(false);
    mockGetUserSalonId.mockReset().mockResolvedValue("salon-1");
  });

  it("plan: zwraca listę z PLAN_FEATURES, ignorując nieaktualne features_json w bazie", async () => {
    queue.push([{ subscription: subscriptionRow(), plan: planRow("pro", STALE) }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan.features).toEqual([...PLAN_FEATURES.pro]);
    expect(JSON.stringify(body)).not.toMatch(STALE_WORDS);
  });

  it("scheduledPlan: zaplanowany plan docelowy też dostaje listę z kodu", async () => {
    queue.push(
      [
        {
          subscription: subscriptionRow({ scheduledPlanId: "plan-basic" }),
          plan: planRow("pro", STALE),
        },
      ],
      [planRow("basic", STALE)],
    );

    const body = await (await GET()).json();

    expect(body.scheduledPlan.slug).toBe("basic");
    expect(body.scheduledPlan.features).toEqual([...PLAN_FEATURES.basic]);
    expect(JSON.stringify(body)).not.toMatch(STALE_WORDS);
  });

  it("plan spoza PLAN_FEATURES zachowuje listę z bazy", async () => {
    queue.push([
      {
        subscription: subscriptionRow({ planId: "plan-enterprise" }),
        plan: planRow("enterprise", ["Dedykowany opiekun"]),
      },
    ]);

    const body = await (await GET()).json();

    expect(body.plan.features).toEqual(["Dedykowany opiekun"]);
  });

  it("plan spoza PLAN_FEATURES bez listy w bazie dostaje pustą tablicę", async () => {
    queue.push([
      {
        subscription: subscriptionRow({ planId: "plan-enterprise" }),
        plan: planRow("enterprise", null),
      },
    ]);

    const body = await (await GET()).json();

    expect(body.plan.features).toEqual([]);
  });

  it("brak subskrypcji -> 200 z subscription: null i plan: null", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      subscription: null,
      plan: null,
      effectivePlanSlug: "basic",
    });
  });

  it("brak sesji -> 401 bez zapytania do bazy", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockClear();
    mockRequireAuth.mockResolvedValue(
      Response.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    );
    mockIsAuthError.mockReturnValue(true);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("użytkownik bez salonu -> 404", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("błąd bazy -> 500 bez szczegółów błędu w odpowiedzi", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await GET();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
  });
});

// Wiersz zapytania getCurrentPlan (select planSlug/planName/status/trialEndsAt).
function currentPlanRow(slug: string, status: string, trialEndsAt: Date | null = null) {
  return { planSlug: slug, planName: slug, status, trialEndsAt };
}
const DAY = 86_400_000;

describe("GET /api/subscriptions/current — effectivePlanSlug z getCurrentPlan", () => {
  beforeEach(() => {
    queue.length = 0;
    vi.mocked(getCurrentPlan).mockClear();
    mockRequireAuth.mockReset().mockResolvedValue({ user: { id: "user-1" } });
    mockIsAuthError.mockReset().mockReturnValue(false);
    mockGetUserSalonId.mockReset().mockResolvedValue("salon-1");
  });

  it("trial Pro po terminie: plan.slug = pro (zapisany), effectivePlanSlug = basic", async () => {
    const ended = new Date(Date.now() - DAY);
    queue.push(
      [{ subscription: subscriptionRow({ status: "trialing", trialEndsAt: ended }), plan: planRow("pro", null) }],
      [currentPlanRow("pro", "trialing", ended)],
    );
    const body = await (await GET()).json();
    expect(body.plan.slug).toBe("pro");
    expect(body.subscription.status).toBe("trialing");
    expect(body.effectivePlanSlug).toBe("basic");
  });

  it("trial Pro bez daty końca → basic", async () => {
    queue.push(
      [{ subscription: subscriptionRow({ status: "trialing" }), plan: planRow("pro", null) }],
      [currentPlanRow("pro", "trialing", null)],
    );
    expect((await (await GET()).json()).effectivePlanSlug).toBe("basic");
  });

  it("trial Pro w terminie → pro", async () => {
    const ends = new Date(Date.now() + DAY);
    queue.push(
      [{ subscription: subscriptionRow({ status: "trialing", trialEndsAt: ends }), plan: planRow("pro", null) }],
      [currentPlanRow("pro", "trialing", ends)],
    );
    expect((await (await GET()).json()).effectivePlanSlug).toBe("pro");
  });

  it("active Pro → pro; active Basic → basic", async () => {
    queue.push([{ subscription: subscriptionRow(), plan: planRow("pro", null) }], [currentPlanRow("pro", "active")]);
    expect((await (await GET()).json()).effectivePlanSlug).toBe("pro");
    queue.push(
      [{ subscription: subscriptionRow({ planId: "plan-basic" }), plan: planRow("basic", null) }],
      [currentPlanRow("basic", "active")],
    );
    expect((await (await GET()).json()).effectivePlanSlug).toBe("basic");
  });

  it("canceled Pro (karta planu pokazuje Pro) → basic, bo getCurrentPlan nie widzi wiersza", async () => {
    queue.push(
      [{ subscription: subscriptionRow({ status: "canceled" }), plan: planRow("pro", null) }],
      [],
    );
    const body = await (await GET()).json();
    expect(body.plan.slug).toBe("pro");
    expect(body.effectivePlanSlug).toBe("basic");
  });

  it("liczy plan dla salonu z sesji, raz na żądanie", async () => {
    queue.push([{ subscription: subscriptionRow(), plan: planRow("pro", null) }], [currentPlanRow("pro", "active")]);
    await GET();
    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(getCurrentPlan).toHaveBeenCalledWith("salon-1");
  });

  it("brak wiersza: getCurrentPlan też woła się z salonem z sesji", async () => {
    await GET();
    expect(getCurrentPlan).toHaveBeenCalledWith("salon-1");
  });

  it("błąd zapytania getCurrentPlan → 200 i basic (fail-closed)", async () => {
    queue.push([{ subscription: subscriptionRow(), plan: planRow("pro", null) }], new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effectivePlanSlug).toBe("basic");
    expect(JSON.stringify(body)).not.toContain("db down");
  });

  it("401 i 404 nie liczą planu", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    mockRequireAuth.mockResolvedValue(Response.json({ success: false }, { status: 401 }));
    mockIsAuthError.mockReturnValue(true);
    expect((await GET()).status).toBe(401);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  it("kształt odpowiedzi: dotychczasowe pola bez zmian, dochodzi tylko effectivePlanSlug", async () => {
    queue.push([{ subscription: subscriptionRow(), plan: planRow("pro", null) }], [currentPlanRow("pro", "active")]);
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(
      ["effectivePlanSlug", "plan", "scheduledPlan", "subscription", "success"].sort(),
    );
    expect(Object.keys(body.subscription).sort()).toEqual(Object.keys(subscriptionRow()).sort());
    expect(Object.keys(body.plan).sort()).toEqual(["features", "id", "isActive", "name", "priceMonthly", "slug"]);
  });
});

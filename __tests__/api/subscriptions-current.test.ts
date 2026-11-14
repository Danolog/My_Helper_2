/**
 * GET /api/subscriptions/current — karta planu w panelu („Funkcje w Twoim
 * planie”) dostaje listy funkcji z kodu (`src/lib/plan-features.ts`), nie z
 * kolumny `features_json`. Stare wiersze w bazie obiecują wyłączone funkcje
 * (B9): asystenta głosowego, zadatki przez Stripe + Blik, drukarkę fiskalną.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/subscriptions/current/route";
import { PLAN_FEATURES } from "@/lib/plan-features";

const { queue, mockRequireAuth, mockIsAuthError, mockGetUserSalonId } = vi.hoisted(() => ({
  // Kolejne zapytania `db.select()` zdejmują wyniki z kolejki (FIFO).
  queue: [] as unknown[][],
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
    ) => Promise.resolve(queue.shift() ?? []).then(resolve, reject);
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
    expect(await res.json()).toEqual({ success: true, subscription: null, plan: null });
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

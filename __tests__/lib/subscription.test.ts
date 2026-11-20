import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to create mock variables that are available inside vi.mock factories
const {
  mockGetUserSalonId,
  mockDbOrderBy,
  mockDbWhere,
  mockDbInnerJoin,
  mockDbFrom,
  mockDbSelect,
  mockLoggerError,
  mockLoggerWarn,
  mockForSalon,
  mockRaw,
} = vi.hoisted(() => {
  // tx.select().from().innerJoin().where().orderBy() -> wiersze (bez limit: wszystkie wiersze salonu)
  const mockDbOrderBy = vi.fn();
  const mockDbWhere = vi.fn().mockReturnValue({ orderBy: mockDbOrderBy });
  const mockDbInnerJoin = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbFrom = vi.fn().mockReturnValue({ innerJoin: mockDbInnerJoin });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
  const mockGetUserSalonId = vi.fn();
  // raw(fn) woła fn z klientem transakcyjnym, jak `withSalonContext` w repozytorium.
  const mockRaw = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ select: mockDbSelect }));
  // Jak prawdziwe `forSalon`: pusty salonId rzuca synchronicznie (przed `raw`).
  const mockForSalon = vi.fn((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { raw: mockRaw, salonId };
  });
  return {
    mockGetUserSalonId,
    mockDbOrderBy,
    mockDbWhere,
    mockDbInnerJoin,
    mockDbFrom,
    mockDbSelect,
    mockLoggerError: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockForSalon,
    mockRaw,
  };
});

// Mock get-user-salon
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: () => mockGetUserSalonId(),
}));

// Odczyt idzie przez repozytorium (`forSalon(salonId).raw`), nie przez surowe `db`.
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => mockForSalon(salonId),
}));

// Surowe `db` nie może być użyte przez `@/lib/subscription` — każde wywołanie to błąd testu.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        throw new Error(`@/lib/subscription użył surowego db.${String(prop)}`);
      },
    }
  ),
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((col: unknown) => ({ type: "desc", col })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  salonSubscriptions: {
    id: "salonSubscriptions.id",
    salonId: "salonSubscriptions.salonId",
    planId: "salonSubscriptions.planId",
    status: "salonSubscriptions.status",
    trialEndsAt: "salonSubscriptions.trialEndsAt",
    currentPeriodStart: "salonSubscriptions.currentPeriodStart",
    currentPeriodEnd: "salonSubscriptions.currentPeriodEnd",
    createdAt: "salonSubscriptions.createdAt",
  },
  subscriptionPlans: {
    id: "subscriptionPlans.id",
    slug: "subscriptionPlans.slug",
    name: "subscriptionPlans.name",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));

// Mock next/headers (needed by get-user-salon -> auth -> session)
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Mock auth (prevents db.ts from loading)
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCurrentPlan, getSalonAccess, isProPlan } from "@/lib/subscription";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** Wiersz odczytu: pola subskrypcji + slug i nazwa planu z joina. */
function row(
  status: string,
  planSlug: "basic" | "pro",
  dates: {
    trialEndsAt?: Date | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    createdAt?: Date;
  } = {}
) {
  return {
    planSlug,
    planName: planSlug === "pro" ? "Pro" : "Basic",
    status,
    trialEndsAt: dates.trialEndsAt ?? null,
    currentPeriodStart: dates.currentPeriodStart ?? null,
    currentPeriodEnd: dates.currentPeriodEnd ?? null,
    createdAt: dates.createdAt ?? at(-60 * DAY),
  };
}

function resetChain() {
  vi.clearAllMocks();
  mockRaw.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({ select: mockDbSelect }));
  mockForSalon.mockImplementation((salonId: string) => {
    if (!salonId) throw new Error("repository.forSalon: salonId wymagany");
    return { raw: mockRaw, salonId };
  });
  mockDbSelect.mockReturnValue({ from: mockDbFrom });
  mockDbFrom.mockReturnValue({ innerJoin: mockDbInnerJoin });
  mockDbInnerJoin.mockReturnValue({ where: mockDbWhere });
  mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy });
  mockDbOrderBy.mockResolvedValue([]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetChain();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCurrentPlan", () => {
  it("should return basic plan when salonId is not provided and user has no salon", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    const plan = await getCurrentPlan();
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "none" });
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("should return basic plan when no subscription is found", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "none" });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("should return the active subscription plan", async () => {
    mockDbOrderBy.mockResolvedValue([row("active", "pro", { currentPeriodEnd: at(20 * DAY) })]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "pro", name: "Pro", status: "active" });
  });

  it("should return trialing plan", async () => {
    mockDbOrderBy.mockResolvedValue([
      // okres próbny w toku (koniec triala: __tests__/lib/subscription-trial-end.test.ts)
      row("trialing", "pro", { trialEndsAt: at(DAY) }),
    ]);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "pro", name: "Pro", status: "trialing" });
  });

  it("zapytanie pobiera daty i wszystkie wiersze salonu od najnowszego (desc createdAt, potem desc id)", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    await getCurrentPlan("salon-123");
    expect(mockDbSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "salonSubscriptions.status",
        trialEndsAt: "salonSubscriptions.trialEndsAt",
        currentPeriodStart: "salonSubscriptions.currentPeriodStart",
        currentPeriodEnd: "salonSubscriptions.currentPeriodEnd",
        createdAt: "salonSubscriptions.createdAt",
      }),
    );
    expect(mockDbOrderBy).toHaveBeenCalledWith(
      { type: "desc", col: "salonSubscriptions.createdAt" },
      { type: "desc", col: "salonSubscriptions.id" },
    );
  });

  it("zapytanie filtruje tylko po salonie (bez filtra statusu)", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    await getCurrentPlan("salon-123");
    expect(mockDbInnerJoin).toHaveBeenCalledWith(expect.anything(), {
      type: "eq",
      args: ["salonSubscriptions.planId", "subscriptionPlans.id"],
    });
    expect(mockDbWhere).toHaveBeenCalledTimes(1);
    expect(mockDbWhere).toHaveBeenCalledWith({ type: "eq", args: ["salonSubscriptions.salonId", "salon-123"] });
  });

  it("bez salonId filtruje po salonie z sesji (getUserSalonId)", async () => {
    mockGetUserSalonId.mockResolvedValue("resolved-salon");
    mockDbOrderBy.mockResolvedValue([]);
    await getCurrentPlan();
    expect(mockDbWhere).toHaveBeenCalledWith({ type: "eq", args: ["salonSubscriptions.salonId", "resolved-salon"] });
  });

  it("jedno zapytanie na wywołanie", async () => {
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(5 * DAY) })]);
    await getCurrentPlan("salon-123");
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
  });

  it("should fallback to basic plan on database error", async () => {
    const error = new Error("DB error");
    mockDbOrderBy.mockRejectedValue(error);
    const plan = await getCurrentPlan("salon-123");
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "unavailable" });
    expect(plan.status).not.toBe("active");
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), { error, salonId: "salon-123" });
  });

  it("błąd getUserSalonId -> basic / unavailable, logger.error", async () => {
    mockGetUserSalonId.mockRejectedValue(new Error("session error"));
    const plan = await getCurrentPlan();
    expect(plan).toEqual({ slug: "basic", name: "Basic", status: "unavailable" });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("should use getUserSalonId when salonId is not provided", async () => {
    mockGetUserSalonId.mockResolvedValue("resolved-salon");
    mockDbOrderBy.mockResolvedValue([row("active", "basic")]);

    await getCurrentPlan();
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });

  it("canceled z currentPeriodEnd w przyszłości -> plan z wiersza ze statusem canceled", async () => {
    mockDbOrderBy.mockResolvedValue([
      row("canceled", "pro", { currentPeriodStart: at(-5 * DAY), currentPeriodEnd: at(10 * DAY) }),
    ]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "pro", name: "Pro", status: "canceled" });
  });

  it("canceled po końcu okresu -> basic ze statusem canceled", async () => {
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(-DAY) })]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "basic", name: "Basic", status: "canceled" });
  });

  it("past_due w łasce (3 dni po końcu okresu) -> plan z wiersza ze statusem past_due", async () => {
    mockDbOrderBy.mockResolvedValue([
      row("past_due", "pro", { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: at(-3 * DAY) }),
    ]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "pro", name: "Pro", status: "past_due" });
  });

  it("past_due po łasce (8 dni po końcu okresu) -> basic ze statusem past_due", async () => {
    mockDbOrderBy.mockResolvedValue([
      row("past_due", "pro", { currentPeriodStart: at(-38 * DAY), currentPeriodEnd: at(-8 * DAY) }),
    ]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "basic", name: "Basic", status: "past_due" });
  });

  it("nieznany status -> basic ze statusem inactive", async () => {
    mockDbOrderBy.mockResolvedValue([row("incomplete", "pro", { currentPeriodEnd: at(10 * DAY) })]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "basic", name: "Basic", status: "inactive" });
  });

  it("starszy active obok nowszego canceled -> plan z wiersza active", async () => {
    mockDbOrderBy.mockResolvedValue([
      row("canceled", "basic", { currentPeriodEnd: at(-DAY), createdAt: at(-5 * DAY) }),
      row("active", "pro", { currentPeriodEnd: at(20 * DAY), createdAt: at(-90 * DAY) }),
    ]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "pro", name: "Pro", status: "active" });
  });

  it("dwa wiersze past_due w łasce z tym samym createdAt -> plan z pierwszego wiersza zwróconego przez zapytanie", async () => {
    const dates = { currentPeriodStart: at(-3 * DAY), currentPeriodEnd: at(27 * DAY), createdAt: at(-5 * DAY) };
    mockDbOrderBy.mockResolvedValue([row("past_due", "pro", dates), row("past_due", "basic", dates)]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "pro", name: "Pro", status: "past_due" });

    mockDbOrderBy.mockResolvedValue([row("past_due", "basic", dates), row("past_due", "pro", dates)]);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "basic", name: "Basic", status: "past_due" });
  });

  it("żadna ścieżka bez pełnego dostępu nie zwraca statusu active", async () => {
    const cases: Array<() => void> = [
      () => mockDbOrderBy.mockResolvedValue([]),
      () => mockDbOrderBy.mockRejectedValue(new Error("DB error")),
      () => mockDbOrderBy.mockResolvedValue([row("trialing", "pro", { trialEndsAt: at(-DAY) })]),
      () => mockDbOrderBy.mockResolvedValue([row("past_due", "pro", { currentPeriodEnd: at(-30 * DAY) })]),
      () => mockDbOrderBy.mockResolvedValue([row("past_due", "pro", { currentPeriodEnd: at(-7 * DAY) })]),
      () => mockDbOrderBy.mockResolvedValue([row("past_due", "pro", { currentPeriodStart: at(-DAY), currentPeriodEnd: null })]),
      () => mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: null })]),
      () => mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(0) })]),
      () => mockDbOrderBy.mockResolvedValue([row("paused", "pro")]),
    ];
    for (const setup of cases) {
      setup();
      const plan = await getCurrentPlan("salon-123");
      expect(plan.slug).toBe("basic");
      expect(plan.status).not.toBe("active");
    }
  });
});

describe("getSalonAccess", () => {
  it("brak wiersza -> none, tylko do odczytu", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    expect(await getSalonAccess("salon-123")).toEqual({ state: "none", mode: "read_only", planSlug: null, until: null });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("błąd odczytu -> unavailable, tylko do odczytu, logger.error raz (error, salonId), bez wyjątku", async () => {
    const error = new Error("DB error");
    mockDbOrderBy.mockRejectedValue(error);
    await expect(getSalonAccess("salon-123")).resolves.toEqual({
      state: "unavailable",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), { error, salonId: "salon-123" });
  });

  it("canceled z currentPeriodEnd w przyszłości -> pełny dostęp do końca okresu", async () => {
    const end = at(10 * DAY);
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: end })]);
    expect(await getSalonAccess("salon-123")).toEqual({
      state: "canceled",
      mode: "full",
      planSlug: "pro",
      until: end,
    });
  });

  it("canceled po końcu okresu -> tylko do odczytu", async () => {
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(-DAY) })]);
    expect(await getSalonAccess("salon-123")).toEqual({
      state: "canceled",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
  });

  it("past_due w łasce -> pełny dostęp do końca okresu + 7 dni", async () => {
    const end = at(-3 * DAY);
    mockDbOrderBy.mockResolvedValue([row("past_due", "basic", { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: end })]);
    expect(await getSalonAccess("salon-123")).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "basic",
      until: new Date(end.getTime() + 7 * DAY),
    });
  });

  it("past_due po łasce -> tylko do odczytu", async () => {
    mockDbOrderBy.mockResolvedValue([
      row("past_due", "basic", { currentPeriodStart: at(-38 * DAY), currentPeriodEnd: at(-8 * DAY) }),
    ]);
    expect(await getSalonAccess("salon-123")).toEqual({
      state: "past_due",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
  });

  it("filtruje po podanym salonie, jedno zapytanie", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    await getSalonAccess("salon-456");
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
    expect(mockDbWhere).toHaveBeenCalledWith({ type: "eq", args: ["salonSubscriptions.salonId", "salon-456"] });
    expect(mockGetUserSalonId).not.toHaveBeenCalled();
  });
});

describe("#193 S1a: odczyt przez forSalon(salonId).raw", () => {
  it("getSalonAccess: forSalon dostaje podany salonId, zapytanie biegnie w raw, jawne eq(salonId) zostaje", async () => {
    mockDbOrderBy.mockResolvedValue([row("active", "pro", { currentPeriodEnd: at(20 * DAY) })]);
    expect(await getSalonAccess("salon-789")).toMatchObject({ state: "active", mode: "full", planSlug: "pro" });
    expect(mockForSalon).toHaveBeenCalledTimes(1);
    expect(mockForSalon).toHaveBeenCalledWith("salon-789");
    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(mockDbSelect).toHaveBeenCalledTimes(1);
    expect(mockDbWhere).toHaveBeenCalledWith({ type: "eq", args: ["salonSubscriptions.salonId", "salon-789"] });
  });

  it("getCurrentPlan bez salonId: forSalon dostaje salon z sesji", async () => {
    mockGetUserSalonId.mockResolvedValue("resolved-salon");
    mockDbOrderBy.mockResolvedValue([row("active", "pro", { currentPeriodEnd: at(20 * DAY) })]);
    expect(await getCurrentPlan()).toEqual({ slug: "pro", name: "Pro", status: "active" });
    expect(mockForSalon).toHaveBeenCalledWith("resolved-salon");
    expect(mockForSalon).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["active Pro", [row("active", "pro", { currentPeriodEnd: at(20 * DAY) })], { slug: "pro", name: "Pro", status: "active" }],
    ["trialing z przyszłą datą", [row("trialing", "basic", { trialEndsAt: at(3 * DAY) })], { slug: "basic", name: "Basic", status: "trialing" }],
    ["trial wygasły", [row("trialing", "pro", { trialEndsAt: at(-DAY) })], { slug: "basic", name: "Basic", status: "trial_expired" }],
    ["canceled przed końcem okresu", [row("canceled", "pro", { currentPeriodEnd: at(4 * DAY) })], { slug: "pro", name: "Pro", status: "canceled" }],
    ["brak wierszy", [], { slug: "basic", name: "Basic", status: "none" }],
  ])("getCurrentPlan przez forSalon: %s", async (_n, rows, expected) => {
    mockDbOrderBy.mockResolvedValue(rows);
    expect(await getCurrentPlan("salon-123")).toEqual(expected);
    expect(mockForSalon).toHaveBeenCalledWith("salon-123");
    expect(mockDbOrderBy).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("forSalon rzuca synchronicznie (pusty salonId) -> unavailable, logger.error, bez wyjątku", async () => {
    await expect(getSalonAccess("")).resolves.toEqual({
      state: "unavailable",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
    expect(mockForSalon).toHaveBeenCalledWith("");
    expect(mockRaw).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), { error: expect.any(Error), salonId: "" });
  });

  it("raw odrzuca (np. brak roli aplikacji / SET LOCAL) -> getCurrentPlan basic/unavailable, isProPlan false", async () => {
    const error = new Error('role "myhelper_app" does not exist');
    mockRaw.mockRejectedValue(error);
    expect(await getCurrentPlan("salon-123")).toEqual({ slug: "basic", name: "Basic", status: "unavailable" });
    expect(await isProPlan("salon-123")).toBe(false);
    expect(mockForSalon).toHaveBeenCalledWith("salon-123");
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), { error, salonId: "salon-123" });
  });

  it("getCurrentPlan() bez salonu w sesji -> basic/none, bez forSalon", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect(await getCurrentPlan()).toEqual({ slug: "basic", name: "Basic", status: "none" });
    expect(mockForSalon).not.toHaveBeenCalled();
  });
});

describe("isProPlan", () => {
  it("should return true when plan is pro", async () => {
    mockDbOrderBy.mockResolvedValue([row("active", "pro")]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(true);
  });

  it("should return false when plan is basic", async () => {
    mockDbOrderBy.mockResolvedValue([row("active", "basic")]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });

  it("should return false when no subscription found (defaults to basic)", async () => {
    mockDbOrderBy.mockResolvedValue([]);
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });

  it("should return false on database error (defaults to basic)", async () => {
    mockDbOrderBy.mockRejectedValue(new Error("DB error"));
    const result = await isProPlan("salon-123");
    expect(result).toBe(false);
  });

  it("anulowany Pro z currentPeriodEnd w przyszłości -> true", async () => {
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(10 * DAY) })]);
    expect(await isProPlan("salon-123")).toBe(true);
  });

  it("anulowany Pro po końcu okresu -> false", async () => {
    mockDbOrderBy.mockResolvedValue([row("canceled", "pro", { currentPeriodEnd: at(-DAY) })]);
    expect(await isProPlan("salon-123")).toBe(false);
  });

  it("past_due Pro w łasce (3 dni po końcu okresu) -> true; po łasce (8 dni po końcu okresu) -> false", async () => {
    mockDbOrderBy.mockResolvedValue([row("past_due", "pro", { currentPeriodEnd: at(-3 * DAY) })]);
    expect(await isProPlan("salon-123")).toBe(true);
    mockDbOrderBy.mockResolvedValue([row("past_due", "pro", { currentPeriodEnd: at(-8 * DAY) })]);
    expect(await isProPlan("salon-123")).toBe(false);
  });
});

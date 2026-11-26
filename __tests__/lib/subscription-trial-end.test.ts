/**
 * Subskrypcje: egzekwowanie końca okresu próbnego po stronie serwera.
 *
 * getCurrentPlan / isProPlan / requireProAI decydują o dostępie do funkcji
 * planu Pro. Wiersz `trialing` liczy się jako bieżący plan tylko do
 * `trialEndsAt` (wyłącznie); `trialing` bez daty końca nie otwiera dostępu.
 * Wiersz `active` nie zależy od `trialEndsAt`.
 *
 * Baza jest atrapą: zwraca dokładnie wiersz z przypadku, więc test sprawdza
 * decyzję podejmowaną w chwili odczytu, a nie filtr w zapytaniu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockGetUserSalonId, mockRequireAuth, mockRateCheck, mockBudget, mockTransaction } = vi.hoisted(() => ({
  mockRows: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockRateCheck: vi.fn(),
  mockBudget: vi.fn(),
  mockTransaction: vi.fn(),
}));

// Łańcuch select().from().innerJoin().where().orderBy().limit() -> wiersze przypadku.
// Odczyt idzie przez prawdziwe `forSalon(salonId).raw` (#193 S1a): transakcja
// z `execute` (SET LOCAL ROLE, set_config) i tym samym łańcuchem na `tx`.
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(mockRows());
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(mockRows()).then(res, rej);
  const client = { select: () => chain, execute: () => Promise.resolve([]) };
  mockTransaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return { db: { ...client, transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn) } };
});

vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: () => mockGetUserSalonId() }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: () => mockRequireAuth(),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/rate-limit", () => ({ aiRateLimit: { checkAsync: () => mockRateCheck() } }));
vi.mock("@/lib/ai/usage-limits", () => ({ checkAIBudget: () => mockBudget() }));
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mockWarn, error: vi.fn(), debug: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { requireProAI } from "@/lib/ai/openrouter";
import { getCurrentPlan, getSalonAccess, isProPlan } from "@/lib/subscription";

const SALON = "salon-1";
const NOW = new Date("2026-11-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function row(status: string, trialEndsAt: Date | null, planSlug = "pro") {
  return {
    planSlug,
    planName: planSlug === "pro" ? "Pro" : "Basic",
    status,
    trialEndsAt,
    currentPeriodEnd: trialEndsAt,
    createdAt: new Date(NOW.getTime() - 20 * DAY),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockRows.mockReset();
  mockWarn.mockReset();
  mockGetUserSalonId.mockReset().mockResolvedValue(SALON);
  mockRequireAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  mockRateCheck.mockReset().mockResolvedValue({ success: true, reset: 0 });
  mockBudget.mockReset().mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("koniec okresu próbnego — getCurrentPlan / isProPlan", () => {
  it("trialing z trialEndsAt w przeszłości -> nie Pro (basic / trial_expired)", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    expect(await getCurrentPlan(SALON)).toEqual({ slug: "basic", name: "Basic", status: "trial_expired" });
    expect(await isProPlan(SALON)).toBe(false);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("trialing bez trialEndsAt -> nie Pro (dostęp zamknięty), jeden logger.warn z samym salonId", async () => {
    mockRows.mockReturnValue([row("trialing", null)]);
    expect(await getCurrentPlan(SALON)).toEqual({ slug: "basic", name: "Basic", status: "trial_expired" });
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith("Trialing subscription without trial end date", { salonId: SALON });
    expect(await isProPlan(SALON)).toBe(false);
  });

  it("trialing z trialEndsAt w przyszłości -> Pro", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() + DAY))]);
    expect(await getCurrentPlan(SALON)).toMatchObject({ slug: "pro", status: "trialing" });
    expect(await isProPlan(SALON)).toBe(true);
  });

  it("active bez trialu -> Pro bez zmian", async () => {
    mockRows.mockReturnValue([row("active", null)]);
    expect(await getCurrentPlan(SALON)).toMatchObject({ slug: "pro", status: "active" });
  });

  it("active z trialEndsAt w przeszłości (trial zamieniony na płatny) -> Pro", async () => {
    mockRows.mockReturnValue([row("active", new Date(NOW.getTime() - 30 * DAY))]);
    expect(await isProPlan(SALON)).toBe(true);
  });

  it("granica: trialEndsAt == teraz -> nie Pro; 1 ms później niż teraz -> Pro", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime()))]);
    expect(await isProPlan(SALON)).toBe(false);
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() + 1))]);
    expect(await isProPlan(SALON)).toBe(true);
  });

  it("czas liczony w chwili odczytu: ten sam wiersz przestaje dawać Pro po upływie terminu", async () => {
    const end = new Date(NOW.getTime() + 60_000);
    mockRows.mockReturnValue([row("trialing", end)]);
    expect(await isProPlan(SALON)).toBe(true);
    vi.setSystemTime(new Date(end.getTime() + 1));
    expect(await isProPlan(SALON)).toBe(false);
  });

  it("trialing Basic po terminie -> Basic (nie podnosi planu)", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY), "basic")]);
    expect((await getCurrentPlan(SALON)).slug).toBe("basic");
    expect(await isProPlan(SALON)).toBe(false);
  });

  it("isProPlan(salonId) (ścieżka cronów) nie woła getUserSalonId i egzekwuje koniec triala", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    expect(await isProPlan("salon-x")).toBe(false);
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() + DAY))]);
    expect(await isProPlan("salon-x")).toBe(true);
    expect(mockGetUserSalonId).not.toHaveBeenCalled();
  });

  it("isProPlan() bez argumentu (sesja) egzekwuje koniec triala", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    expect(await isProPlan()).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
  });

  it("trial w terminie oddaje plan i status bez zmian (bez logu)", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() + DAY))]);
    expect(await getCurrentPlan(SALON)).toEqual({ slug: "pro", name: "Pro", status: "trialing" });
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe("koniec okresu próbnego — getSalonAccess", () => {
  it("trial w terminie -> trialing, pełny dostęp do trialEndsAt", async () => {
    const end = new Date(NOW.getTime() + DAY);
    mockRows.mockReturnValue([row("trialing", end)]);
    expect(await getSalonAccess(SALON)).toEqual({ state: "trialing", mode: "full", planSlug: "pro", until: end });
  });

  it("trial po terminie -> expired, tylko do odczytu", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    expect(await getSalonAccess(SALON)).toEqual({ state: "expired", mode: "read_only", planSlug: null, until: null });
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockRows).toHaveBeenCalledTimes(1);
  });

  it("trialing bez daty końca -> expired, jeden logger.warn z samym salonId", async () => {
    mockRows.mockReturnValue([row("trialing", null)]);
    expect(await getSalonAccess(SALON)).toMatchObject({ state: "expired", mode: "read_only" });
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith("Trialing subscription without trial end date", { salonId: SALON });
  });

  it("przedłużenie: przesunięcie trialEndsAt z przeszłości na przyszłość przy statusie trialing zdejmuje tryb tylko do odczytu", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    expect(await getSalonAccess(SALON)).toEqual({ state: "expired", mode: "read_only", planSlug: null, until: null });
    // Ten sam wiersz po UPDATE samej kolumny trial_ends_at (status bez zmian).
    const extended = new Date(NOW.getTime() + 90 * DAY);
    mockRows.mockReturnValue([row("trialing", extended)]);
    expect(await getSalonAccess(SALON)).toEqual({ state: "trialing", mode: "full", planSlug: "pro", until: extended });
    expect(await isProPlan(SALON)).toBe(true);
  });

  it("brak salonu w sesji -> getCurrentPlan zwraca basic ze statusem none", async () => {
    mockGetUserSalonId.mockResolvedValue(null);
    expect(await getCurrentPlan()).toEqual({ slug: "basic", name: "Basic", status: "none" });
  });
});

describe("koniec okresu próbnego — requireProAI", () => {
  it("trial po terminie -> 403 PLAN_UPGRADE_REQUIRED, bez limitu i budżetu", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() - DAY))]);
    const result = await requireProAI();
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PLAN_UPGRADE_REQUIRED" });
    expect(mockRateCheck).not.toHaveBeenCalled();
    expect(mockBudget).not.toHaveBeenCalled();
    // Odmowa z odczytanego wiersza, nie z błędu odczytu (inaczej 403 byłoby fałszywie zielone).
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockRows).toHaveBeenCalledTimes(1);
  });

  it("trialing bez daty końca -> 403", async () => {
    mockRows.mockReturnValue([row("trialing", null)]);
    expect(((await requireProAI()) as Response).status).toBe(403);
    expect(mockRows).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith("Trialing subscription without trial end date", { salonId: SALON });
  });

  it("trial w terminie -> dostęp ({ salonId })", async () => {
    mockRows.mockReturnValue([row("trialing", new Date(NOW.getTime() + DAY))]);
    expect(await requireProAI()).toEqual({ salonId: SALON });
  });
});

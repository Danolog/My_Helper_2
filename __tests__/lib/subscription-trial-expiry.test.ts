/**
 * Test odtwarzający bloker B1 (docs/PLAN_WEJSCIA_NA_RYNEK_2026-11.md):
 * subskrypcja ze statusem `trialing`, której `trialEndsAt` minął, nadal dawała
 * pełny plan Pro. Przypadek z produkcji: trial zakończony 20.07.2026, w
 * listopadzie konto wciąż miało Pro.
 *
 * Test celowo dotyka wyłącznie publicznego API modułu (`getCurrentPlan`,
 * `isProPlan`), a mock bazy jest „elastyczny" (każde ogniwo łańcucha zapytania
 * jest awaitowalne), żeby ten sam plik dało się uruchomić na kodzie sprzed
 * poprawki i po niej.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { rowsRef } = vi.hoisted(() => ({
  rowsRef: { rows: [] as unknown[] },
}));

vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  // Awaitowalny łańcuch: `await db.select()...orderBy()` i `...limit(1)` zwracają wiersze.
  chain.then = (
    resolve: (rows: unknown[]) => unknown,
    reject: (error: unknown) => unknown
  ) => Promise.resolve(rowsRef.rows).then(resolve, reject);
  return { db: chain };
});

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue("salon-1"),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { getCurrentPlan, isProPlan } from "@/lib/subscription";

/** Wiersz w kształcie czytanym zarówno przez stary, jak i nowy kod. */
function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    planSlug: "pro",
    planName: "Pro",
    status: "trialing",
    trialEndsAt: new Date("2026-07-20T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-07-20T00:00:00.000Z"),
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    ...overrides,
  };
}

describe("B1: trial po terminie nie daje dostępu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Dzień audytu produkcji — prawie 4 miesiące po końcu trialu.
    vi.setSystemTime(new Date("2026-11-14T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("status `trialing` z trialEndsAt w przeszłości nie daje planu Pro", async () => {
    rowsRef.rows = [subscriptionRow()];

    expect(await isProPlan("salon-1")).toBe(false);
  });

  it("status `trialing` z trialEndsAt w przeszłości jest raportowany jako `expired`", async () => {
    rowsRef.rows = [subscriptionRow()];

    const plan = await getCurrentPlan("salon-1");

    expect(plan.status).toBe("expired");
  });

  it("trial w toku nadal daje plan Pro (kontrola — poprawka nie może go zabrać)", async () => {
    rowsRef.rows = [
      subscriptionRow({
        trialEndsAt: new Date("2026-11-20T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-11-20T00:00:00.000Z"),
        createdAt: new Date("2026-11-06T00:00:00.000Z"),
      }),
    ];

    expect(await isProPlan("salon-1")).toBe(true);
    expect((await getCurrentPlan("salon-1")).status).toBe("trialing");
  });
});

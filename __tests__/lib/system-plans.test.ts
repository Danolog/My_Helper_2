/**
 * #193 P5b — cennik: odczyt i dosiewanie planów w `src/lib/server/system/plans.ts`
 * (jawne wyjście z rejestru `getActivePlans`), zawsze na `dbSystem` (§6).
 * Jedyna zamierzona zmiana zachowania: dosiewanie z ON CONFLICT (slug) DO NOTHING
 * (wyścig dwóch GET na pustej tabeli: dziś 23505 → 500, po P5b oba 200).
 * Usunięcie dosiewania to osobny PR „plans-ro”, nie P5b.
 *
 * Czerwone do PR P5b: moduł nie istnieje (ładowany dynamicznie), trasa liczy
 * sama na `@/lib/db`. Pula żądań rzuca przy każdym użyciu; `dbSystem` to osobny
 * fałszywy klient. Test pg wyścigu i UNIQUE w pg_constraint — w PR P5b (slot).
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseResponse } from "../api/helpers";

const requestPool = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`pula żądań użyta w ścieżce systemowej (db.${String(prop)})`);
        },
      }
    )
);
vi.mock("@/lib/db", () => ({ db: requestPool }));

const sys = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const select = vi.fn((..._a: unknown[]) => ({ from: () => ({ where: selectWhere }) }));
  const inserted: unknown[] = [];
  const onConflict = vi.fn((..._a: unknown[]) => Promise.resolve(undefined));
  const insert = vi.fn((..._a: unknown[]) => ({
    values: (v: unknown) => {
      inserted.push(...(Array.isArray(v) ? v : [v]));
      const chain = Promise.resolve(undefined) as Promise<undefined> & { onConflictDoNothing: typeof onConflict };
      chain.onConflictDoNothing = onConflict;
      return chain;
    },
  }));
  return { selectWhere, select, insert, inserted, onConflict };
});
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: { select: sys.select, insert: sys.insert },
}));

const registry = vi.hoisted(() => ({ getActivePlans: vi.fn() }));
vi.mock("@/lib/server/system", () => registry);

import { GET } from "@/app/api/subscription-plans/route";

const MODULE = path.resolve(__dirname, "../../src/lib/server/system/plans.ts");
type Plan = { id: string; name: string; slug: string; priceMonthly: string; featuresJson: unknown; isActive: boolean };
async function loadGetActivePlans(): Promise<() => Promise<Plan[]>> {
  const mod = (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  expect(typeof mod.getActivePlans, "eksport getActivePlans").toBe("function");
  return mod.getActivePlans as () => Promise<Plan[]>;
}

const plan = (slug: string): Plan => ({
  id: `id-${slug}`,
  name: slug === "basic" ? "Basic" : "Pro",
  slug,
  priceMonthly: slug === "basic" ? "49.00" : "149.00",
  featuresJson: [],
  isActive: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  sys.inserted.length = 0;
});

describe("system/plans.ts: getActivePlans (P5b)", () => {
  it("są plany → zwraca je i niczego nie zapisuje", async () => {
    sys.selectWhere.mockResolvedValue([plan("pro"), plan("basic")]);
    const getActivePlans = await loadGetActivePlans();
    await expect(getActivePlans()).resolves.toHaveLength(2);
    expect(sys.insert).not.toHaveBeenCalled();
  });

  it("pusta tabela → dosiewa Basic i Pro z ON CONFLICT DO NOTHING i zwraca je po ponownym odczycie", async () => {
    sys.selectWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([plan("basic"), plan("pro")]);
    const getActivePlans = await loadGetActivePlans();
    await expect(getActivePlans()).resolves.toHaveLength(2);
    expect((sys.inserted as Array<{ slug: string }>).map((p) => p.slug).sort()).toEqual(["basic", "pro"]);
    // Każde wstawienie z ON CONFLICT DO NOTHING (bez tego wyścig = 23505 → 500).
    expect(sys.onConflict).toHaveBeenCalledTimes(sys.insert.mock.calls.length);
    expect(sys.select).toHaveBeenCalledTimes(2);
  });
});

describe("trasa GET /api/subscription-plans woła wyjście z rejestru (P5b)", () => {
  it("200: plany z rejestru, Basic przed Pro, bez puli żądań", async () => {
    registry.getActivePlans.mockResolvedValue([plan("pro"), plan("basic")]);
    const { status, body: data } = await parseResponse(await GET());
    expect(status).toBe(200);
    expect(data).toMatchObject({ success: true });
    expect((data as { data: Array<{ slug: string }> }).data.map((p) => p.slug)).toEqual(["basic", "pro"]);
    expect(registry.getActivePlans).toHaveBeenCalledTimes(1);
  });

  it("błąd wyjścia systemowego → 500 z dotychczasowym komunikatem", async () => {
    registry.getActivePlans.mockRejectedValue(new Error("boom"));
    const { status, body: data } = await parseResponse(await GET());
    expect(status).toBe(500);
    expect(data).toMatchObject({ success: false, error: "Failed to fetch subscription plans" });
    expect(registry.getActivePlans).toHaveBeenCalledTimes(1);
  });
});

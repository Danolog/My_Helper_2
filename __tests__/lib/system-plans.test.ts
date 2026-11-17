// @vitest-environment node
/**
 * #193 P5b: wyjście systemowe `ensurePlansExist` (`src/lib/server/system/plans.ts`).
 *
 * Pula systemowa to prawdziwy budowniczy drizzle (`pg-proxy`), który zapisuje
 * renderowany SQL i parametry; wiersze odczytów podaje skrypt testu. Pula
 * żądań (`@/lib/db`) rzuca przy każdym użyciu.
 *
 * - pusta tabela → dwa wstawienia z `ON CONFLICT ("slug") DO NOTHING`, potem
 *   ponowny odczyt aktywnych; wynik = ponowny odczyt;
 * - są aktywne plany → jeden odczyt, żadnego zapisu;
 * - wstawiane wartości pochodzą z kodu (`PLANS`, `PLAN_FEATURES`).
 */
import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/constants";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { subscriptionPlans } from "@/lib/schema";
// `vi.mock` jest wynoszone nad importy — wyjście dostaje atrapy obu pul.
import { ensurePlansExist } from "@/lib/server/system/plans";

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then") return undefined;
        throw new Error(`wyjście systemowe użyło db (${String(p)}) zamiast dbSystem`);
      },
    }
  ),
}));

const sys = vi.hoisted(() => ({
  captured: [] as Array<{ sql: string; params: unknown[] }>,
  /** Kolejne wyniki odczytów (SELECT), w kolejności wywołań. */
  selects: [] as unknown[][][],
}));

vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const dbSystem = drizzle(async (sql: string, params: unknown[]) => {
    sys.captured.push({ sql, params });
    if (/^\s*select\b/i.test(sql)) return { rows: sys.selects.shift() ?? [] };
    return { rows: [] };
  });
  return { dbSystem };
});

type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  stripePriceId: string | null;
  featuresJson: unknown;
  isActive: boolean;
  createdAt: Date | null;
};

const COLUMNS = Object.keys(getTableColumns(subscriptionPlans)) as Array<keyof Plan>;

function plan(slug: string): Plan {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    priceMonthly: "49.00",
    stripePriceId: null,
    featuresJson: ["Funkcja"],
    isActive: true,
    createdAt: null,
  };
}

/** Wiersz w trybie tablicowym pg-proxy (kolejność kolumn tabeli). */
const asRow = (p: Plan) => COLUMNS.map((c) => p[c]);

const inserts = () => sys.captured.filter((q) => /^\s*insert\b/i.test(q.sql));
const selects = () => sys.captured.filter((q) => /^\s*select\b/i.test(q.sql));

beforeEach(() => {
  sys.captured.length = 0;
  sys.selects = [];
});

describe("system/plans.ts: ensurePlansExist()", () => {
  it("pusta tabela → wstawia 2 plany z konfliktem po slug ignorowanym i zwraca wynik ponownego odczytu", async () => {
    sys.selects = [[], [asRow(plan("basic")), asRow(plan("pro"))]];

    const result = await ensurePlansExist();

    expect(result.map((p) => p.slug)).toEqual(["basic", "pro"]);
    expect(result[0]).toMatchObject({ id: "id-basic", isActive: true });

    const ins = inserts();
    expect(ins).toHaveLength(2);
    for (const q of ins) {
      expect(q.sql).toMatch(/^insert into "subscription_plans"/i);
      expect(q.sql).toMatch(/on conflict \("slug"\) do nothing\s*$/i);
    }

    // Kolejność zapytań: odczyt aktywnych → 2 wstawienia → ponowny odczyt aktywnych.
    const kinds = sys.captured.map((q) => q.sql.trim().split(/\s+/)[0]!.toLowerCase());
    expect(kinds).toEqual(["select", "insert", "insert", "select"]);
    for (const q of selects()) {
      expect(q.sql).toMatch(/from "subscription_plans" where "subscription_plans"\."is_active" = \$1$/i);
      expect(q.params).toEqual([true]);
    }
  });

  it("wstawiane wartości pochodzą z kodu (nazwa, slug, cena, lista funkcji), plan aktywny", async () => {
    sys.selects = [[], []];
    await ensurePlansExist();

    const ins = inserts();
    expect(ins).toHaveLength(2);
    const expected = [
      [PLANS.basic.name, PLANS.basic.slug, PLANS.basic.priceMonthly.toFixed(2), PLAN_FEATURES.basic],
      [PLANS.pro.name, PLANS.pro.slug, PLANS.pro.priceMonthly.toFixed(2), PLAN_FEATURES.pro],
    ] as const;
    ins.forEach((q, i) => {
      const [name, slug, price, features] = expected[i]!;
      expect(q.params).toContain(name);
      expect(q.params).toContain(slug);
      expect(q.params).toContain(price);
      expect(q.params).toContain(true);
      expect(q.params).toContain(JSON.stringify([...features]));
    });
  });

  it("pusta tabela, a ponowny odczyt nadal pusty (plany istnieją, ale nieaktywne) → pusta lista, bez błędu", async () => {
    sys.selects = [[], []];
    await expect(ensurePlansExist()).resolves.toEqual([]);
    expect(inserts()).toHaveLength(2);
  });

  it("są aktywne plany → jeden odczyt, żadnego zapisu", async () => {
    sys.selects = [[asRow(plan("basic"))]];

    const result = await ensurePlansExist();

    expect(result.map((p) => p.slug)).toEqual(["basic"]);
    expect(sys.captured).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
  });

  it("błąd bazy przy odczycie → propaguje", async () => {
    const { dbSystem } = await import("@/lib/server/system/db-system");
    const spy = vi.spyOn(dbSystem, "select").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(ensurePlansExist()).rejects.toThrow("db down");
    spy.mockRestore();
  });
});

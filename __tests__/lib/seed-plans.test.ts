// @vitest-environment node
/**
 * Plany w seedzie testowym (`scripts/seed-plans.ts`, #193 P5b) — bez bazy.
 * SQL sprawdzany przez `toSQL()` zapytania Drizzle na prawdziwym obiekcie
 * `drizzle(...)` bez połączenia (postgres.js nie łączy się przed pierwszym zapytaniem).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { PLANS } from "@/lib/constants";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { SEED_PLANS, seedPlansQuery } from "../../scripts/seed-plans";

const client = postgres("postgres://nobody@localhost:1/none", { max: 1 });
const db = drizzle(client);
afterAll(() => client.end({ timeout: 0 }));

const ROOT = join(__dirname, "..", "..");
const code = (file: string) =>
  readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("SEED_PLANS: wartości z PLANS i PLAN_FEATURES", () => {
  it("dokładnie dwa plany: basic i pro", () => {
    expect(SEED_PLANS.map((p) => p.slug)).toEqual(["basic", "pro"]);
  });

  it.each([["basic"], ["pro"]] as const)("%s: nazwa, slug, cena i funkcje z kodu", (slug) => {
    const p = SEED_PLANS.find((x) => x.slug === slug)!;
    expect(p.name).toBe(PLANS[slug].name);
    expect(p.slug).toBe(PLANS[slug].slug);
    expect(p.priceMonthly).toBe(PLANS[slug].priceMonthly.toFixed(2));
    expect(p.featuresJson).toEqual([...PLAN_FEATURES[slug]]);
    expect(p.isActive).toBe(true);
  });

  it("stałe identyfikatory różne dla obu planów", () => {
    const ids = SEED_PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("seedPlansQuery: idempotentnie po slug", () => {
  const { sql, params } = seedPlansQuery(db).toSQL();

  it("jedno INSERT do subscription_plans z oboma planami", () => {
    expect(sql).toMatch(/^insert into "subscription_plans"/);
    for (const p of SEED_PLANS) {
      expect(params).toContain(p.slug);
      expect(params).toContain(p.name);
      expect(params).toContain(p.priceMonthly);
    }
  });

  it('ON CONFLICT ("slug") DO NOTHING — bez nadpisywania istniejącego wiersza', () => {
    expect(sql).toMatch(/on conflict \("slug"\) do nothing\s*$/);
    expect(sql).not.toMatch(/do update/i);
  });
});

describe("seed-test.ts używa seed-plans", () => {
  const src = code("scripts/seed-test.ts");

  it("woła seedPlans(db) z ./seed-plans", () => {
    expect(src).toMatch(/import\s*\{\s*seedPlans\s*\}\s*from\s*"\.\/seed-plans"/);
    expect(src).toMatch(/await seedPlans\(db\)/);
  });

  it("nie wstawia planów sam (bez subscriptionPlans i ręcznych cen)", () => {
    expect(src).not.toMatch(/subscriptionPlans/);
    expect(src).not.toMatch(/"(49|149)\.00"/);
  });
});

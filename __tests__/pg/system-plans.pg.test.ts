/**
 * #193 P5b-2: `ensurePlansExist()` (system/plans.ts) na PRAWDZIWYM Postgresie.
 *
 * Sprawdza:
 *   - w bazie istnieje ograniczenie UNIQUE dokładnie na `subscription_plans.slug`
 *     (na nim opiera się `ON CONFLICT (slug) DO NOTHING`),
 *   - dwa równoległe wywołania przy braku aktywnych planów kończą się sukcesem
 *     i zostawiają dokładnie po jednym wierszu na slug z `PLANS`,
 *   - przy istniejących aktywnych planach nic nie jest zapisywane,
 *   - gdy plany są, ale żaden nie jest aktywny — pusta lista, bez zapisu.
 *
 * Stan tabeli: test działa na pustej tabeli i na tabeli z planami (np. po
 * seedzie). Na czas przypadku wiersze zastane są ODSUWANE: `slug` →
 * `odsuniety-<RUN>-<1|0>:<oryginalny slug>` (1/0 = pierwotne `is_active`),
 * `is_active = false`. Wierszy zastanych test nie usuwa — wskazuje na nie
 * `salon_subscriptions.plan_id` (`onDelete: restrict`). Po przypadku (`finally`)
 * i w `afterAll` test usuwa wiersze, których nie było w migawce, i przywraca
 * zastanym `slug` oraz `is_active`. Ostatni przypadek porównuje migawkę sprzed
 * i po.
 *
 * Odsunięcie i przywrócenie wykonują się każde w jednej transakcji, więc po
 * przerwaniu (Ctrl+C) tabela jest albo w stanie wyjściowym, albo „odsuniętym”:
 * wszystkie zastane wiersze mają slug `odsuniety-…`, a KAŻDY inny wiersz wstawił
 * test (slug `it-t3-sp-…` albo slugi z `PLANS`). Wyjątek: tabela pusta przed
 * testem — wtedy mogą zostać plany domyślne z `PLANS` (jak po dosianiu przez
 * aplikację); usunąć je ręcznie, jeśli nie są potrzebne. Naprawa WYŁĄCZNIE na lokalnym
 * Dockerze (`-h localhost`, baza `pos_dev`; przed uruchomieniem sprawdź host):
 *
 *   psql -h localhost -U dev_user -d pos_dev -v ON_ERROR_STOP=1 -c "
 *     BEGIN;
 *     DELETE FROM subscription_plans
 *      WHERE slug LIKE 'it-t3-%'
 *         OR (slug NOT LIKE 'odsuniety-%'
 *             AND EXISTS (SELECT 1 FROM subscription_plans o WHERE o.slug LIKE 'odsuniety-%'));
 *     UPDATE subscription_plans
 *        SET is_active = split_part(split_part(slug, ':', 1), '-', 3) = '1',
 *            slug = split_part(slug, ':', 2)
 *      WHERE slug LIKE 'odsuniety-%';
 *     COMMIT;"
 *
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/<baza> pnpm test:pg -- __tests__/pg/system-plans.pg.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/constants";
import { subscriptionPlans } from "@/lib/schema";
import { ensurePlansExist } from "@/lib/server/system/plans";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type PlanRow = typeof subscriptionPlans.$inferSelect;

const RUN = randomUUID().slice(0, 8);
const DEFAULT_SLUGS = [PLANS.basic.slug, PLANS.pro.slug].sort();

let before: PlanRow[] | null = null;

async function snapshot(): Promise<PlanRow[]> {
  return h!.db.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.id));
}

/** Zastane wiersze: tymczasowy slug z pierwotnym `is_active` i slugiem, `is_active = false`. */
async function stashExisting() {
  await h!.db.transaction(async (tx) => {
    for (const row of before!) {
      await tx
        .update(subscriptionPlans)
        .set({ slug: `odsuniety-${RUN}-${row.isActive ? "1" : "0"}:${row.slug}`, isActive: false })
        .where(eq(subscriptionPlans.id, row.id));
    }
  });
}

/** Usuwa wiersze spoza migawki i przywraca zastanym `slug` oraz `is_active`. Idempotentne. */
async function restore() {
  if (!before) return;
  const original = before;
  await h!.db.transaction(async (tx) => {
    const current = await tx.select({ id: subscriptionPlans.id }).from(subscriptionPlans);
    const originalIds = new Set(original.map((r) => r.id));
    const extra = current.map((r) => r.id).filter((id) => !originalIds.has(id));
    if (extra.length > 0) await tx.delete(subscriptionPlans).where(inArray(subscriptionPlans.id, extra));
    for (const row of original) {
      await tx
        .update(subscriptionPlans)
        .set({ slug: row.slug, isActive: row.isActive })
        .where(eq(subscriptionPlans.id, row.id));
    }
  });
}

async function insertTestPlan(slug: string, isActive: boolean) {
  const [row] = await h!.db
    .insert(subscriptionPlans)
    .values({ name: `IT T3 plan ${RUN}`, slug, priceMonthly: "1.00", isActive })
    .returning({ id: subscriptionPlans.id });
  return row!.id;
}

async function tableIds() {
  const rows = await h!.db.select({ id: subscriptionPlans.id }).from(subscriptionPlans);
  return rows.map((r) => r.id).sort();
}

/** Status wyniku z kodem błędu Postgresa (np. 23505), także gdy jest w `cause`. */
function describeSettled(r: PromiseSettledResult<unknown>) {
  if (r.status === "fulfilled") return "fulfilled";
  const reason = r.reason as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = reason?.code ?? reason?.cause?.code ?? "?";
  const message = reason?.cause?.message ?? reason?.message ?? String(r.reason);
  return `rejected ${code}: ${message}`;
}

const suite = h ? describe : describe.skip;

suite("ensurePlansExist — dosiewanie planów, prawdziwy Postgres", () => {
  beforeAll(async () => {
    before = await snapshot();
  });

  afterAll(async () => {
    if (!h) return;
    try {
      await restore();
    } finally {
      await h.end();
    }
  });

  it("w bazie jest ograniczenie UNIQUE dokładnie na kolumnie slug", async () => {
    const rows = await h!.db.execute<{ conname: string; cols: string }>(sql`
      SELECT c.conname::text AS conname,
             string_agg(a.attname::text, ',' ORDER BY a.attname) AS cols
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'subscription_plans'::regclass
         AND c.contype = 'u'
       GROUP BY c.conname
    `);
    const constraints = Array.from(rows).map((r) => ({ conname: r.conname, cols: r.cols }));
    expect(constraints).toContainEqual({ conname: "subscription_plans_slug_unique", cols: "slug" });
  });

  it("dwa równoległe wywołania bez aktywnych planów → oba spełnione, dokładnie po jednym wierszu na slug", async () => {
    try {
      await stashExisting();
      const active = await h!.db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
      expect(active, "przed wywołaniem nie powinno być aktywnych planów").toEqual([]);

      const settled = await Promise.allSettled([ensurePlansExist(), ensurePlansExist()]);
      expect(settled.map(describeSettled)).toEqual(["fulfilled", "fulfilled"]);

      for (const r of settled) {
        const plans = (r as PromiseFulfilledResult<PlanRow[]>).value;
        expect(plans.map((p) => p.slug).sort()).toEqual(DEFAULT_SLUGS);
        expect(plans.every((p) => p.isActive)).toBe(true);
      }

      const stored = await h!.db
        .select({ slug: subscriptionPlans.slug, isActive: subscriptionPlans.isActive })
        .from(subscriptionPlans)
        .where(inArray(subscriptionPlans.slug, DEFAULT_SLUGS));
      expect(stored.map((s) => s.slug).sort()).toEqual(DEFAULT_SLUGS);
      expect(stored.every((s) => s.isActive)).toBe(true);
      expect(await tableIds()).toHaveLength(before!.length + DEFAULT_SLUGS.length);
    } finally {
      await restore();
    }
  });

  it("są aktywne plany → zwraca istniejące wiersze, nic nie zapisuje", async () => {
    try {
      await stashExisting();
      const a = await insertTestPlan(`it-t3-sp-${RUN}-a`, true);
      const b = await insertTestPlan(`it-t3-sp-${RUN}-b`, true);
      const idsBefore = await tableIds();

      const plans = await ensurePlansExist();

      expect(plans.map((p) => p.id).sort()).toEqual([a, b].sort());
      expect(await tableIds()).toEqual(idsBefore);
    } finally {
      await restore();
    }
  });

  // Brak aktywnych → funkcja próbuje dosiać; slugi z `PLANS` są zajęte przez
  // nieaktywne wiersze, więc konflikt jest pomijany, a ponowny odczyt aktywnych jest pusty.
  it("plany istnieją, ale żaden nie jest aktywny → pusta lista, bez błędu, bez nowych wierszy", async () => {
    try {
      await stashExisting();
      const inactive: string[] = [];
      for (const slug of DEFAULT_SLUGS) inactive.push(await insertTestPlan(slug, false));
      const idsBefore = await tableIds();

      await expect(ensurePlansExist()).resolves.toEqual([]);

      expect(await tableIds()).toEqual(idsBefore);
      const bySlug = await h!.db
        .select({ id: subscriptionPlans.id, isActive: subscriptionPlans.isActive })
        .from(subscriptionPlans)
        .where(inArray(subscriptionPlans.slug, DEFAULT_SLUGS));
      expect(bySlug.map((r) => r.id).sort()).toEqual([...inactive].sort());
      expect(bySlug.every((r) => !r.isActive)).toBe(true);
    } finally {
      await restore();
    }
  });

  it("tabela po przypadkach jest taka sama jak przed testem", async () => {
    expect(await snapshot()).toEqual(before);
  });
});

/**
 * `GET /api/subscriptions/expiration-warning` na PRAWDZIWYM Postgresie — salony A i B
 * z aktywną subskrypcją na dwóch różnych planach.
 *
 * Trasa czyta aktywną subskrypcję przez `forSalon(salonId).raw` (rola bez BYPASSRLS +
 * `app.current_salon_id`), złączenie `salon_subscriptions` z `subscription_plans`.
 * Moduł `@/lib/server/repository` nie jest podmieniany; `@/lib/db` to pula harnessu,
 * `@/lib/auth-middleware` i `@/lib/get-user-salon` to atrapy (salon w sesji ustawia
 * każdy przypadek), `@/lib/logger` — atrapa.
 *
 * Przypadki:
 * - salon A w sesji → 200, wiersz A i plan 1;
 * - salon B w sesji → 200, wiersz B i plan 2;
 * - salon C (jedyny wiersz o statusie `canceled`) w sesji → 200 i `data: null`;
 * - złączenie z trasy wykonane wprost przez `forSalon(A).raw` i `forSalon(B).raw`, bez
 *   warunku salonu w `where` (tylko status `active` i id dwóch aktywnych wierszy testu):
 *   każdy kontekst widzi tylko swój wiersz — cudzy odcina polityka wierszy, nie `where`;
 * - kontrola: to samo złączenie na puli harnessu (rola właściciela, omija polityki)
 *   widzi oba wiersze.
 * Asercje tylko o wierszach utworzonych przez test (baza może mieć inne dane).
 *
 * Dane: użytkownicy `it-t3-exp-…`, salony „IT T3 exp A/B/C …”, plany o slugu
 * `it-t3-exp-1-…` i `it-t3-exp-2-…` (prefiksy z notatki sprzątania w pg-harness.ts),
 * trzy wiersze `salon_subscriptions`. `afterAll` usuwa salony (kaskada zabiera
 * subskrypcje), potem plany, potem użytkowników.
 * Uruchomienie samego pliku (`pnpm test:pg -- <plik>` nie zawęża przebiegu — biegną wszystkie testy pg): `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/subscription-expiration-warning.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS i rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/subscriptions/expiration-warning/route";
import { salonSubscriptions, salons, subscriptionPlans, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ requireAuth: vi.fn(), getUserSalonId: vi.fn() }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAuth: (...a: unknown[]) => ctl.requireAuth(...a),
    isAuthError: (r: unknown) => r instanceof NextResponse,
  };
});
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...a: unknown[]) => ctl.getUserSalonId(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-exp-a-${RUN}`;
const OWNER_B = `it-t3-exp-b-${RUN}`;
const OWNER_C = `it-t3-exp-c-${RUN}`;
const PLAN_1 = { name: `IT T3 exp plan 1 ${RUN}`, slug: `it-t3-exp-1-${RUN}`, priceMonthly: "49.00" };
const PLAN_2 = { name: `IT T3 exp plan 2 ${RUN}`, slug: `it-t3-exp-2-${RUN}`, priceMonthly: "149.00" };
const DAY_MS = 86_400_000;

const ids = {
  salonA: "",
  salonB: "",
  salonC: "",
  plan1: "",
  plan2: "",
  subA: "",
  subB: "",
  subC: "",
};

type Data = { subscriptionId: string; planSlug: string; planName: string; status: string } | null;

async function callGet(salonId: string, ownerId: string) {
  ctl.requireAuth.mockResolvedValue({ user: { id: ownerId } });
  ctl.getUserSalonId.mockResolvedValue(salonId);
  const res = await GET();
  return { status: res.status, body: (await res.json()) as { success: boolean; data: Data } };
}

/** Złączenie z trasy bez warunku salonu: status `active`, ograniczone do dwóch aktywnych wierszy testu. */
function activeJoinOfTestRows() {
  return and(eq(salonSubscriptions.status, "active"), inArray(salonSubscriptions.id, [ids.subA, ids.subB]));
}

const joinColumns = { subscriptionId: salonSubscriptions.id, planSlug: subscriptionPlans.slug };

const suite = h ? describe : describe.skip;

suite("GET /api/subscriptions/expiration-warning — salony A i B, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT T3 exp A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT T3 exp B", email: `${OWNER_B}@example.invalid` },
      { id: OWNER_C, name: "IT T3 exp C", email: `${OWNER_C}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT T3 exp A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT T3 exp B ${RUN}`, ownerId: OWNER_B }).returning();
    const [c] = await db.insert(salons).values({ name: `IT T3 exp C ${RUN}`, ownerId: OWNER_C }).returning();
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    ids.salonC = c!.id;
    const [p1] = await db.insert(subscriptionPlans).values(PLAN_1).returning();
    const [p2] = await db.insert(subscriptionPlans).values(PLAN_2).returning();
    ids.plan1 = p1!.id;
    ids.plan2 = p2!.id;
    const [sa] = await db
      .insert(salonSubscriptions)
      .values({ salonId: ids.salonA, planId: ids.plan1, status: "active", currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS) })
      .returning();
    const [sb] = await db
      .insert(salonSubscriptions)
      .values({ salonId: ids.salonB, planId: ids.plan2, status: "active", currentPeriodEnd: new Date(Date.now() + 40 * DAY_MS) })
      .returning();
    const [sc] = await db
      .insert(salonSubscriptions)
      .values({ salonId: ids.salonC, planId: ids.plan1, status: "canceled", currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS) })
      .returning();
    ids.subA = sa!.id;
    ids.subB = sb!.id;
    ids.subC = sc!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Kaskada z salonu usuwa subskrypcje; plan (restrict) potem; użytkownik (właściciel) na końcu.
      for (const id of [ids.salonA, ids.salonB, ids.salonC]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      for (const id of [ids.plan1, ids.plan2]) if (id) await h.db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, id));
      await h.db.delete(user).where(inArray(user.id, [OWNER_A, OWNER_B, OWNER_C]));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.requireAuth.mockReset();
    ctl.getUserSalonId.mockReset();
  });

  it("salon A w sesji → 200; data.subscriptionId = wiersz A, data.planSlug i data.planName = plan 1, nie plan 2", async () => {
    const { status, body } = await callGet(ids.salonA, OWNER_A);

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data?.subscriptionId).toBe(ids.subA);
    expect(body.data?.planSlug).toBe(PLAN_1.slug);
    expect(body.data?.planName).toBe(PLAN_1.name);
    expect(JSON.stringify(body)).not.toContain(PLAN_2.slug);
  });

  it("salon B w sesji → 200; data.subscriptionId = wiersz B, data.planSlug i data.planName = plan 2, nie plan 1", async () => {
    const { status, body } = await callGet(ids.salonB, OWNER_B);

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data?.subscriptionId).toBe(ids.subB);
    expect(body.data?.planSlug).toBe(PLAN_2.slug);
    expect(body.data?.planName).toBe(PLAN_2.name);
    expect(JSON.stringify(body)).not.toContain(PLAN_1.slug);
  });

  it("salon C (jedyny wiersz o statusie canceled) w sesji, przy aktywnych wierszach A i B → 200 i data: null", async () => {
    const { status, body } = await callGet(ids.salonC, OWNER_C);

    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data).toBeNull();
  });

  it("złączenie z trasy przez forSalon(A).raw i forSalon(B).raw bez warunku salonu w where (status active, id dwóch aktywnych wierszy testu) → A widzi tylko wiersz A z planem 1, B tylko wiersz B z planem 2", async () => {
    const asA = await forSalon(ids.salonA).raw((tx) =>
      tx
        .select(joinColumns)
        .from(salonSubscriptions)
        .innerJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
        .where(activeJoinOfTestRows())
    );
    const asB = await forSalon(ids.salonB).raw((tx) =>
      tx
        .select(joinColumns)
        .from(salonSubscriptions)
        .innerJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
        .where(activeJoinOfTestRows())
    );

    expect(asA).toEqual([{ subscriptionId: ids.subA, planSlug: PLAN_1.slug }]);
    expect(asB).toEqual([{ subscriptionId: ids.subB, planSlug: PLAN_2.slug }]);
  });

  it("kontrola: to samo złączenie na puli harnessu bez forSalon i bez warunku salonu (status active, id dwóch aktywnych wierszy testu) → oba wiersze, A z planem 1 i B z planem 2", async () => {
    const rows = await h!.db
      .select(joinColumns)
      .from(salonSubscriptions)
      .innerJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
      .where(activeJoinOfTestRows());

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ subscriptionId: ids.subA, planSlug: PLAN_1.slug });
    expect(rows).toContainEqual({ subscriptionId: ids.subB, planSlug: PLAN_2.slug });
  });
});

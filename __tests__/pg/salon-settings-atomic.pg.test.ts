/**
 * Atomowy zapis ustawień salonu na PRAWDZIWYM Postgresie, pod rolą aplikacji
 * (forSalon, RLS `salons` po `id`).
 *
 * Trasy: PUT /api/salons/[id]/{modules,loyalty-settings,birthday-settings,
 * notification-type-settings,we-miss-you-settings} oraz PUT /api/salon/blik-deposit.
 * Każda podmienia jeden klucz `settings_json` przez `jsonb_set(coalesce(...))`.
 *
 * (a) Salon A z `deposits` (numer testowy + data zgody): PUT każdej trasy → 200,
 *     klucz trasy zapisany, `deposits` bez zmian.
 * (b) Salon B: po zapisach dla A jego `settings_json` identyczny.
 * (c) Wycofanie numeru (`blikPhone: null`), potem PUT loyalty-settings →
 *     `deposits` zostaje wyczyszczone, nie wraca ze starej kopii.
 * (d) `settings_json` = `'{}'` i SQL NULL → 200 (coalesce). JSON null
 *     (`'null'::jsonb`) → 500: `coalesce` nie zamienia skalarnego null jsonb,
 *     a `jsonb_set` na skalarze rzuca błąd. Test dokumentuje dzisiejszy wynik.
 *
 * Atrapy: sesja (requireAuth, requireSalonStaff) i logger. Baza, RLS i trasy — prawdziwe.
 * Dane: użytkownicy `it-t3-set-…` (prefiks z notatki sprzątania w pg-harness.ts),
 * dwa salony; sprzątanie w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg`.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { PUT as putBlikDeposit } from "@/app/api/salon/blik-deposit/route";
import { PUT as putBirthday } from "@/app/api/salons/[id]/birthday-settings/route";
import { PUT as putLoyalty } from "@/app/api/salons/[id]/loyalty-settings/route";
import { PUT as putModules } from "@/app/api/salons/[id]/modules/route";
import { PUT as putNotificationTypes } from "@/app/api/salons/[id]/notification-type-settings/route";
import { PUT as putWeMissYou } from "@/app/api/salons/[id]/we-miss-you-settings/route";
import { logger } from "@/lib/logger";
import { salons, user } from "@/lib/schema";
import { TEST_PHONE_NUMBERS } from "@/lib/test-phone";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

/** Zalogowany właściciel: id użytkownika i jego salon. */
const session = vi.hoisted(() => ({ userId: "", salonId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: session.userId, name: "IT", email: "it@example.invalid" } }),
  isAuthError: () => false,
}));
// blik-deposit bierze salon wyłącznie z sesji; atrapa zwraca kontekst właściciela.
vi.mock("@/lib/salon-context", () => ({
  requireSalonStaff: async () => ({
    ctx: { salonId: session.salonId, role: "owner", employeeId: null, userId: session.userId },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type Put = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type Route = { name: string; key: string; put: Put; body: Record<string, unknown> };

const ROUTES: Route[] = [
  { name: "modules", key: "modules", put: putModules, body: { modules: { promotions: true } } },
  { name: "loyalty-settings", key: "loyalty", put: putLoyalty, body: { enabled: true, pointsPerCurrencyUnit: 2 } },
  { name: "birthday-settings", key: "birthdayGift", put: putBirthday, body: { enabled: true, discountPercentage: 15 } },
  {
    name: "notification-type-settings",
    key: "notificationTypes",
    put: putNotificationTypes,
    body: { smsReminders: false, birthdayNotifications: false },
  },
  { name: "we-miss-you-settings", key: "weMissYou", put: putWeMissYou, body: { enabled: true, inactiveDays: 45 } },
];
const LOYALTY = ROUTES[1]!;

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-set-a-${RUN}`;
const OWNER_B = `it-t3-set-b-${RUN}`;
const DEPOSITS = { blikPhone: TEST_PHONE_NUMBERS[0]!, blikConsentAt: "2026-11-19T08:00:00.000Z" };
const SETTINGS_B = {
  deposits: { blikPhone: TEST_PHONE_NUMBERS[1]!, blikConsentAt: "2026-11-18T08:00:00.000Z" },
  loyalty: { enabled: false, pointsPerCurrencyUnit: 7 },
};
let salonA = "";
let salonB = "";

function callPut(route: Route, salonId: string) {
  return route.put(
    new Request(`http://localhost/api/salons/${salonId}/${route.name}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(route.body),
    }),
    { params: Promise.resolve({ id: salonId }) }
  );
}

function withdrawBlik() {
  return putBlikDeposit(
    new Request("http://localhost/api/salon/blik-deposit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blikPhone: null }),
    })
  );
}

/** `settings_json` salonu prosto z bazy (połączenie obserwatora, bez RLS aplikacji). */
async function settingsOf(salonId: string): Promise<Record<string, unknown> | null> {
  const [r] = await h!.observer<{ s: Record<string, unknown> | null }[]>`
    select settings_json as s from salons where id = ${salonId}`;
  return r!.s;
}

/** Rodzaj wartości: SQL NULL odróżniony od JSON null (oba w JS dają `null`). */
async function settingsKind(salonId: string): Promise<{ sqlNull: boolean; jsonType: string | null }> {
  const [r] = await h!.observer<{ sqlNull: boolean; jsonType: string | null }[]>`
    select settings_json is null as "sqlNull", jsonb_typeof(settings_json) as "jsonType"
    from salons where id = ${salonId}`;
  return r!;
}

async function setSettings(salonId: string, value: ReturnType<typeof sql>) {
  await h!.db.update(salons).set({ settingsJson: value }).where(eq(salons.id, salonId));
}

const suite = h ? describe : describe.skip;

suite("ustawienia salonu — zapis jednego klucza, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values([
      { id: OWNER_A, name: "IT Set A", email: `${OWNER_A}@example.invalid` },
      { id: OWNER_B, name: "IT Set B", email: `${OWNER_B}@example.invalid` },
    ]);
    const [a] = await db.insert(salons).values({ name: `IT Set A ${RUN}`, ownerId: OWNER_A }).returning();
    const [b] = await db.insert(salons).values({ name: `IT Set B ${RUN}`, ownerId: OWNER_B }).returning();
    salonA = a!.id;
    salonB = b!.id;
    session.userId = OWNER_A;
    session.salonId = salonA;
  });

  afterAll(async () => {
    if (!h) return;
    const db = h.db;
    if (salonA) await db.delete(salons).where(eq(salons.id, salonA));
    if (salonB) await db.delete(salons).where(eq(salons.id, salonB));
    await db.delete(user).where(eq(user.id, OWNER_A));
    await db.delete(user).where(eq(user.id, OWNER_B));
    await h.end();
  });

  beforeEach(async () => {
    vi.mocked(logger.error).mockClear();
    await setSettings(salonA, sql`${JSON.stringify({ deposits: DEPOSITS })}::jsonb`);
    await setSettings(salonB, sql`${JSON.stringify(SETTINGS_B)}::jsonb`);
  });

  it.each(ROUTES)("(a)+(b) PUT $name dla A → 200, klucz zapisany, deposits A i cały salon B bez zmian", async (route) => {
    const beforeA = await settingsOf(salonA);
    const beforeB = await settingsOf(salonB);
    expect(beforeA?.deposits).toEqual(DEPOSITS);

    const res = await callPut(route, salonA);

    expect(res.status).toBe(200);
    const afterA = await settingsOf(salonA);
    expect(afterA?.deposits).toEqual(beforeA?.deposits);
    expect(afterA?.[route.key]).toEqual(expect.any(Object));
    expect(Object.keys(afterA!).sort()).toEqual(["deposits", route.key].sort());
    expect(await settingsOf(salonB)).toEqual(beforeB);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("(a)+(b) wszystkie trasy po kolei dla A → każdy klucz zapisany raz, deposits nietknięte, B identyczny", async () => {
    const beforeB = await settingsOf(salonB);

    for (const route of ROUTES) expect((await callPut(route, salonA)).status, route.name).toBe(200);

    const afterA = await settingsOf(salonA);
    expect(afterA?.deposits).toEqual(DEPOSITS);
    expect(Object.keys(afterA!).sort()).toEqual(["deposits", ...ROUTES.map((r) => r.key)].sort());
    expect(afterA?.loyalty).toEqual(expect.objectContaining({ enabled: true, pointsPerCurrencyUnit: 2 }));
    expect(afterA?.modules).toEqual(expect.objectContaining({ promotions: true }));
    expect(await settingsOf(salonB)).toEqual(beforeB);
  });

  it("(c) wycofanie numeru, potem PUT loyalty-settings → deposits wyczyszczone, numer nie wraca", async () => {
    const beforeB = await settingsOf(salonB);

    const withdrawn = await withdrawBlik();
    expect(withdrawn.status).toBe(200);
    const cleared = { blikPhone: null, blikConsentAt: null };
    expect((await settingsOf(salonA))?.deposits).toEqual(cleared);

    expect((await callPut(LOYALTY, salonA)).status).toBe(200);

    const afterA = await settingsOf(salonA);
    expect(afterA?.deposits).toEqual(cleared);
    expect(JSON.stringify(afterA)).not.toContain(DEPOSITS.blikPhone);
    expect(afterA?.loyalty).toEqual(expect.objectContaining({ enabled: true }));
    expect(await settingsOf(salonB)).toEqual(beforeB);
  });

  it("(d) settings_json = '{}' → 200, zapisany tylko klucz trasy", async () => {
    await setSettings(salonA, sql`'{}'::jsonb`);

    expect((await callPut(LOYALTY, salonA)).status).toBe(200);

    expect(Object.keys((await settingsOf(salonA))!)).toEqual(["loyalty"]);
  });

  it("(d) settings_json = SQL NULL → 200 (coalesce), zapisany tylko klucz trasy", async () => {
    await setSettings(salonA, sql`NULL`);
    expect(await settingsKind(salonA)).toEqual({ sqlNull: true, jsonType: null });

    expect((await callPut(LOYALTY, salonA)).status).toBe(200);

    expect(Object.keys((await settingsOf(salonA))!)).toEqual(["loyalty"]);
  });

  it("(d) settings_json = JSON null ('null'::jsonb) → dziś 500 i wartość bez zmian (znany dług, bez naprawy)", async () => {
    await setSettings(salonA, sql`'null'::jsonb`);
    expect(await settingsKind(salonA)).toEqual({ sqlNull: false, jsonType: "null" });

    expect((await callPut(LOYALTY, salonA)).status).toBe(500);

    expect(await settingsKind(salonA)).toEqual({ sqlNull: false, jsonType: "null" });
    expect(logger.error).toHaveBeenCalled();
  });
});

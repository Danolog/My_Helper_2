/**
 * Atomowy zapis ustawień salonu: PUT /api/salons/[id]/{modules,loyalty-settings,birthday-settings}.
 *
 * Każda z tras zapisuje TYLKO swój klucz `salons.settingsJson` jednym
 * `UPDATE ... SET settings_json = jsonb_set(...)`. Zapis całego obiektu
 * ustawień ze starej kopii mógłby przywrócić klucz `deposits` (numer BLIK
 * właściciela), który właściciel właśnie usunął równoległym żądaniem.
 *
 * Przez prawdziwe forSalon i prawdziwy drizzle — argument `set(...)` UPDATE
 * jest przechwytywany i renderowany dialektem Postgresa. Mockowane: sesja
 * (requireAuth), pula bazy (salon-staff-harness) i logger.
 *
 * Numer telefonu: fikcyjny, nie wychodzi do sieci.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT as putBirthday } from "@/app/api/salons/[id]/birthday-settings/route";
import { PUT as putLoyalty } from "@/app/api/salons/[id]/loyalty-settings/route";
import { PUT as putModules } from "@/app/api/salons/[id]/modules/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  /** Argumenty każdego tx.update(...).set(x). */
  const setArgs: Record<string, unknown>[] = [];

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  const db = {
    transaction: (fn: (tx: Tx) => unknown) =>
      m.db.transaction((tx) =>
        fn({
          ...tx,
          update: () => {
            const chain = tx.update();
            chain.set = (v: Record<string, unknown>) => {
              setArgs.push(v);
              return chain;
            };
            return chain;
          },
        })
      ),
  };

  const requireAuth = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, setArgs, db, requireAuth, logger };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: h.requireAuth,
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

const OWNER_ID = "owner-a";
const BLIK_PHONE = "+48600100200";

/** settingsJson w bazie: numer BLIK i ustawienia wszystkich trzech tras. */
const STORED_SETTINGS = {
  deposits: { blikPhone: BLIK_PHONE, blikConsentAt: "2026-11-19T08:00:00.000Z" },
  modules: { products: true },
  loyalty: { enabled: true, pointsPerCurrencyUnit: 5 },
  birthdayGift: { enabled: true, discountPercentage: 20 },
};

type Put = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

type Route = { name: string; key: string; put: Put; body: Record<string, unknown> };

const MODULES_ROUTE: Route = {
  name: "modules",
  key: "modules",
  put: putModules,
  body: { modules: { promotions: true } },
};
const LOYALTY_ROUTE: Route = {
  name: "loyalty-settings",
  key: "loyalty",
  put: putLoyalty,
  body: { enabled: true, pointsPerCurrencyUnit: 2 },
};
const BIRTHDAY_ROUTE: Route = {
  name: "birthday-settings",
  key: "birthdayGift",
  put: putBirthday,
  body: { enabled: true, discountPercentage: 15 },
};

const ROUTES: Route[] = [MODULES_ROUTE, LOYALTY_ROUTE, BIRTHDAY_ROUTE];

const OTHER_KEYS = ["deposits", "modules", "loyalty", "birthdayGift"];

function callPut(route: Route) {
  return route.put(
    new Request(`http://localhost/api/salons/${SALON_A}/${route.name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route.body),
    }),
    { params: Promise.resolve({ id: SALON_A }) }
  );
}

/** Wiersz salonu dla odczytu przed zapisem (sprawdzenie właściciela). */
function storedSalonRow() {
  m.txRows.push([{ id: SALON_A, ownerId: OWNER_ID, settingsJson: STORED_SETTINGS }]);
}

/** SQL wartości `settingsJson` z jedynego UPDATE: tekst i parametry. */
function onlySettingsWrite() {
  expect(h.setArgs).toHaveLength(1);
  const arg = h.setArgs[0]!;
  expect(Object.keys(arg)).toEqual(["settingsJson"]);
  return dialect.sqlToQuery(arg.settingsJson as SQL);
}

beforeEach(() => {
  m.reset();
  h.setArgs.length = 0;
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
});

describe.each(ROUTES)("PUT /api/salons/[id]/$name — zapis atomowy", (route) => {
  it(`jeden jsonb_set na kluczu ${route.key}, parametr bez deposits i bez innych kluczy`, async () => {
    storedSalonRow();

    expect((await callPut(route)).status).toBe(200);

    const write = onlySettingsWrite();
    expect(write.sql).toBe(
      `jsonb_set(coalesce("salons"."settings_json", '{}'::jsonb), '{${route.key}}', $1::jsonb)`
    );
    expect(write.sql.match(/jsonb_set/g)).toHaveLength(1);
    expect(write.params).toHaveLength(1);

    const value = JSON.parse(write.params[0] as string) as Record<string, unknown>;
    for (const key of OTHER_KEYS) expect(value).not.toHaveProperty(key);

    // UPDATE zawężony do salonu z adresu.
    const update = m.writes.find((w) => w.op === "update");
    const where = dialect.sqlToQuery(update!.where as SQL);
    expect(where.sql).toBe('"salons"."id" = $1');
    expect(where.params).toEqual([SALON_A]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("w bazie jest deposits z numerem — parametr zapisu i odpowiedź nie zawierają numeru", async () => {
    storedSalonRow();

    const res = await callPut(route);
    expect(res.status).toBe(200);

    const write = onlySettingsWrite();
    expect(JSON.stringify(write.params)).not.toContain("600100200");
    expect(JSON.stringify(write.params)).not.toContain("blik");
    expect(JSON.stringify(await res.json())).not.toContain("600100200");
  });

  it("403 dla nie-właściciela — bez zapisu", async () => {
    h.requireAuth.mockResolvedValue({ user: { id: "someone-else" } });
    storedSalonRow();

    expect((await callPut(route)).status).toBe(403);
    expect(h.setArgs).toEqual([]);
  });

  it("404 gdy salon nie istnieje — bez zapisu", async () => {
    m.txRows.push([]);

    expect((await callPut(route)).status).toBe(404);
    expect(h.setArgs).toEqual([]);
  });
});

describe("wartość klucza liczona jak przed zmianą", () => {
  it("modules: częściowy PUT scala się z dotychczasowymi modułami", async () => {
    storedSalonRow();

    const res = await callPut(MODULES_ROUTE);
    expect(res.status).toBe(200);

    const value = JSON.parse(onlySettingsWrite().params[0] as string);
    expect(value).toEqual({ products: true, promotions: true });
    const data = (await res.json()).data;
    expect(data.products).toBe(true);
    expect(data.promotions).toBe(true);
  });

  it("loyalty: zapis = wartości z body uzupełnione domyślnymi", async () => {
    storedSalonRow();

    expect((await callPut(LOYALTY_ROUTE)).status).toBe(200);

    expect(JSON.parse(onlySettingsWrite().params[0] as string)).toEqual({
      enabled: true,
      pointsPerCurrencyUnit: 2,
      currencyUnit: 1,
      pointsExpiryDays: null,
      rewardTiers: [],
    });
  });

  it("birthdayGift: zapis = wartości z body uzupełnione domyślnymi", async () => {
    storedSalonRow();

    expect((await callPut(BIRTHDAY_ROUTE)).status).toBe(200);

    const value = JSON.parse(onlySettingsWrite().params[0] as string);
    expect(value).toMatchObject({
      enabled: true,
      giftType: "discount",
      discountPercentage: 15,
      productName: "",
      autoSend: false,
    });
    expect(Object.keys(value).sort()).toEqual(
      ["autoSend", "customMessage", "discountPercentage", "enabled", "giftType", "productName"]
    );
  });
});

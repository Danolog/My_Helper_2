/**
 * Trasy publiczne `promotions/check`, `check-happy-hours`, `check-package`.
 *
 * Moduł complexPromotions jest zamrożony: bramka odpowiada przed czymkolwiek,
 * bez forSalon. Po odmrożeniu (zdjęcie `hardOff` z wpisu w `MODULES`, jak
 * w frozen-promotions-unfreeze.test.ts):
 *   - zły format id z query → odpowiedź w kształcie kontraktu trasy
 *     (`200 eligible:false` albo `data: []`), bez forSalon;
 *   - wszystkie odczyty w JEDNEJ transakcji forSalon(salonId z query);
 *   - jawne listy kolumn i jawne eq(salonId) w każdym zapytaniu;
 *   - wynik jak przed przeniesieniem na forSalon;
 *   - błąd bazy → 500, w logu sama tożsamość błędu (bez treści i parametrów).
 */
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as checkBuy2Get1 } from "@/app/api/promotions/check/route";
import { GET as checkHappyHours } from "@/app/api/promotions/check-happy-hours/route";
import { GET as checkPackage } from "@/app/api/promotions/check-package/route";
import { MODULES } from "@/lib/features";
import { logger } from "@/lib/logger";

interface SelectCall {
  cols: Record<string, unknown> | undefined;
  table: string | undefined;
  where: SQL | undefined;
  inTransaction: boolean;
}

const state = vi.hoisted(() => ({
  forSalonCalls: [] as string[],
  rawCalls: 0,
  depth: 0,
  selects: [] as SelectCall[],
  queue: [] as unknown[][],
  failWith: null as Error | null,
}));

// forSalon(salonId).raw(fn): fn dostaje tx, który zapisuje każde zapytanie
// (kolumny, tabela, where) i oddaje wiersze z kolejki.
vi.mock("@/lib/server/repository", async () => {
  const { getTableName: tableName } = await import("drizzle-orm");
  const select = (cols?: Record<string, unknown>) => {
    if (state.failWith) throw state.failWith;
    const call: SelectCall = {
      cols,
      table: undefined,
      where: undefined,
      inTransaction: state.depth > 0,
    };
    state.selects.push(call);
    const rows = state.queue.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: (t: PgTable) => {
        call.table = tableName(t);
        return chain;
      },
      where: (w: SQL) => {
        call.where = w;
        return chain;
      },
      limit: async () => rows,
      then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return {
    forSalon: (salonId: string) => {
      state.forSalonCalls.push(salonId);
      return {
        salonId,
        raw: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
          state.rawCalls += 1;
          state.depth += 1;
          try {
            return await fn({ select });
          } finally {
            state.depth -= 1;
          }
        },
      };
    },
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SALON = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const SERVICE_2 = "44444444-4444-4444-8444-444444444444";
const BAD = "not-a-uuid";

const PROMO_COLS = ["id", "name", "value", "startDate", "endDate", "conditionsJson"];

const dialect = new PgDialect();

/** Czy where zawiera `<tabela>.salon_id = $n` z parametrem równym salonowi z query. */
function hasEqSalonId(where: SQL | undefined, table: string): boolean {
  if (!where) return false;
  const { sql, params } = dialect.sqlToQuery(where);
  const re = new RegExp(`(?:"${table}"\\.)?"salon_id" = \\$(\\d+)`, "g");
  return [...sql.matchAll(re)].some((m) => params[Number(m[1]) - 1] === SALON);
}

/** Odmrożenie w rejestrze: zdjęcie `hardOff` z wpisu modułu, po teście przywrócenie. */
async function withComplexPromotionsUnfrozen<T>(fn: () => Promise<T>): Promise<T> {
  const entry = MODULES.find((m) => m.key === "complexPromotions") as { hardOff?: boolean | undefined };
  const before = entry.hardOff;
  entry.hardOff = false;
  try {
    return await fn();
  } finally {
    entry.hardOff = before;
  }
}

async function call(handler: (r: Request) => Promise<Response>, path: string) {
  const res = await handler(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() };
}

const buy2get1Path = (salonId = SALON, clientId = CLIENT, serviceId = SERVICE) =>
  `/api/promotions/check?salonId=${salonId}&clientId=${clientId}&serviceId=${serviceId}`;
const happyHoursPath = (salonId = SALON, time = "14:00") =>
  `/api/promotions/check-happy-hours?salonId=${salonId}&date=2026-07-06&time=${time}`;
const packagePath = (salonId = SALON) => `/api/promotions/check-package?salonId=${salonId}`;

const promo = (overrides: Record<string, unknown>) => ({
  id: "promo-1",
  name: "Promo",
  value: "20",
  startDate: null,
  endDate: null,
  conditionsJson: {},
  ...overrides,
});

beforeEach(() => {
  state.forSalonCalls.length = 0;
  state.rawCalls = 0;
  state.depth = 0;
  state.selects.length = 0;
  state.queue.length = 0;
  state.failWith = null;
  vi.mocked(logger.error).mockClear();
});

describe("moduł zamrożony — odpowiada bramka, forSalon niewołany", () => {
  it.each([
    ["check", checkBuy2Get1, buy2get1Path()],
    ["check-happy-hours", checkHappyHours, happyHoursPath()],
    ["check-package", checkPackage, packagePath()],
  ] as const)("%s → 404 bramki", async (_n, handler, path) => {
    const { status } = await call(handler, path);
    expect(status).toBe(404);
    expect(state.forSalonCalls).toEqual([]);
    expect(state.selects).toEqual([]);
  });
});

describe("odmrożone: brakujące parametry bez zmian", () => {
  it("check bez clientId → 200 eligible:false, bez forSalon", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      const { status, body } = await call(
        checkBuy2Get1,
        `/api/promotions/check?salonId=${SALON}&serviceId=${SERVICE}`
      );
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: { eligible: false, reason: "Missing required parameters" } });
      expect(state.forSalonCalls).toEqual([]);
    });
  });

  it("check-package bez salonId → 200 data:[], bez forSalon", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      const { status, body } = await call(checkPackage, "/api/promotions/check-package");
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: [] });
      expect(state.forSalonCalls).toEqual([]);
    });
  });
});

describe("odmrożone: zły format id → odpowiedź kontraktu, bez forSalon", () => {
  it.each([
    ["salonId", buy2get1Path(BAD)],
    ["clientId", buy2get1Path(SALON, BAD)],
    ["serviceId", buy2get1Path(SALON, CLIENT, BAD)],
  ])("check: zły %s → 200 eligible:false", async (_n, path) => {
    await withComplexPromotionsUnfrozen(async () => {
      const { status, body } = await call(checkBuy2Get1, path);
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: { eligible: false, reason: "Invalid parameters" } });
      expect(state.forSalonCalls).toEqual([]);
    });
  });

  it("check-happy-hours: zły salonId → 200 eligible:false", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      const { status, body } = await call(checkHappyHours, happyHoursPath(BAD));
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: { eligible: false, reason: "Invalid parameters" } });
      expect(state.forSalonCalls).toEqual([]);
    });
  });

  it("check-package: zły salonId → 200 data:[]", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      const { status, body } = await call(checkPackage, packagePath(BAD));
      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: [] });
      expect(state.forSalonCalls).toEqual([]);
    });
  });
});

describe("odmrożone: check (2+1)", () => {
  it("trzecia wizyta → eligible, wszystkie odczyty w jednej transakcji forSalon, jawne kolumny i eq(salonId)", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([promo({ name: "2+1" })], [{ count: 2 }], [{ basePrice: "100.00" }]);
      const { status, body } = await call(checkBuy2Get1, buy2get1Path());

      expect(status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: {
          eligible: true,
          appointmentCount: 2,
          promotionId: "promo-1",
          promotionName: "2+1",
          discountPercent: 20,
          originalPrice: 100,
          discountAmount: 20,
          finalPrice: 80,
          reason: "Promocja 2+1: 20% znizki na 3. wizyte!",
        },
      });

      expect(state.forSalonCalls).toEqual([SALON]);
      expect(state.rawCalls).toBe(1);
      expect(state.selects.map((s) => s.table)).toEqual(["promotions", "appointments", "services"]);
      expect(state.selects.every((s) => s.inTransaction)).toBe(true);
      for (const s of state.selects) {
        expect(s.cols, s.table).toBeDefined();
        expect(hasEqSalonId(s.where, s.table!), s.table).toBe(true);
      }
      expect(Object.keys(state.selects[0]!.cols!)).toEqual(PROMO_COLS);
      expect(Object.keys(state.selects[1]!.cols!)).toEqual(["count"]);
      expect(Object.keys(state.selects[2]!.cols!)).toEqual(["basePrice"]);
    });
  });

  it("za mało wizyt → eligible:false z licznikiem, bez odczytu usługi", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([promo({ name: "2+1" })], [{ count: 0 }]);
      const { body } = await call(checkBuy2Get1, buy2get1Path());
      expect(body).toEqual({
        success: true,
        data: {
          eligible: false,
          appointmentCount: 0,
          remainingForPromo: 2,
          reason: "Potrzeba jeszcze 2 wizyt(y) do promocji 2+1",
          promotionName: "2+1",
        },
      });
      expect(state.selects.map((s) => s.table)).toEqual(["promotions", "appointments"]);
    });
  });

  it("promocja na inną usługę → brak promocji", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([promo({ conditionsJson: { applicableServiceIds: [SERVICE_2] } })]);
      const { body } = await call(checkBuy2Get1, buy2get1Path());
      expect(body).toEqual({
        success: true,
        data: { eligible: false, reason: "No applicable buy2get1 promotions" },
      });
      expect(state.selects).toHaveLength(1);
    });
  });
});

describe("odmrożone: check-happy-hours", () => {
  const hh = (value: string) =>
    promo({
      id: `hh-${value}`,
      name: `Happy -${value}%`,
      value,
      // 2026-07-06 to poniedziałek.
      conditionsJson: { daysOfWeek: [1], startTime: "12:00", endTime: "16:00" },
    });

  it("w oknie → najwyższy rabat; jedna transakcja, jawne kolumny i eq(salonId)", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([hh("10"), hh("20")]);
      const { status, body } = await call(checkHappyHours, happyHoursPath());
      expect(status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: {
          eligible: true,
          promotionId: "hh-20",
          promotionName: "Happy -20%",
          discountPercent: 20,
          startTime: "12:00",
          endTime: "16:00",
          daysOfWeek: [1],
          reason: "Happy Hours: -20% (12:00-16:00)",
        },
      });
      expect(state.forSalonCalls).toEqual([SALON]);
      expect(state.rawCalls).toBe(1);
      expect(state.selects).toHaveLength(1);
      expect(state.selects[0]!.table).toBe("promotions");
      expect(state.selects[0]!.inTransaction).toBe(true);
      expect(Object.keys(state.selects[0]!.cols!)).toEqual(PROMO_COLS);
      expect(hasEqSalonId(state.selects[0]!.where, "promotions")).toBe(true);
    });
  });

  it("poza oknem → eligible:false", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([hh("20")]);
      const { body } = await call(checkHappyHours, happyHoursPath(SALON, "20:30"));
      expect(body).toEqual({
        success: true,
        data: { eligible: false, reason: "No applicable happy hours promotions for this time slot" },
      });
    });
  });
});

describe("odmrożone: check-package", () => {
  it("pakiet z usługami w kolejności z warunków; jedna transakcja, jawne kolumny i eq(salonId)", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push(
        [promo({ id: "pkg-1", name: "Pakiet", value: "150", conditionsJson: { packageServiceIds: [SERVICE_2, SERVICE] } })],
        [
          { id: SERVICE, name: "Strzyżenie", basePrice: "100.00", baseDuration: 30 },
          { id: SERVICE_2, name: "Farbowanie", basePrice: "80.00", baseDuration: 60 },
        ]
      );
      const { status, body } = await call(checkPackage, packagePath());
      expect(status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: [
          {
            id: "pkg-1",
            name: "Pakiet",
            packagePrice: 150,
            totalIndividualPrice: 180,
            savings: 30,
            totalDuration: 90,
            services: [
              { id: SERVICE_2, name: "Farbowanie", basePrice: "80.00", baseDuration: 60 },
              { id: SERVICE, name: "Strzyżenie", basePrice: "100.00", baseDuration: 30 },
            ],
          },
        ],
      });
      expect(state.forSalonCalls).toEqual([SALON]);
      expect(state.rawCalls).toBe(1);
      expect(state.selects.map((s) => s.table)).toEqual(["promotions", "services"]);
      expect(state.selects.every((s) => s.inTransaction)).toBe(true);
      expect(Object.keys(state.selects[0]!.cols!)).toEqual(PROMO_COLS);
      expect(Object.keys(state.selects[1]!.cols!)).toEqual(["id", "name", "basePrice", "baseDuration"]);
      for (const s of state.selects) expect(hasEqSalonId(s.where, s.table!), s.table).toBe(true);
    });
  });

  it("pakiet z mniej niż dwiema usługami → pominięty, bez odczytu usług", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      state.queue.push([promo({ conditionsJson: { packageServiceIds: [SERVICE] } })]);
      const { body } = await call(checkPackage, packagePath());
      expect(body).toEqual({ success: true, data: [] });
      expect(state.selects).toHaveLength(1);
    });
  });
});

describe("odmrożone: błąd bazy → 500, w logu sama tożsamość błędu", () => {
  it.each([
    ["check", checkBuy2Get1, buy2get1Path(), "Failed to check promotions"],
    ["check-happy-hours", checkHappyHours, happyHoursPath(), "Failed to check happy hours promotions"],
    ["check-package", checkPackage, packagePath(), "Failed to check packages"],
  ] as const)("%s", async (_n, handler, path, message) => {
    await withComplexPromotionsUnfrozen(async () => {
      state.failWith = new Error(`Failed query: select ...\nparams: ${CLIENT}`);
      const { status, body } = await call(handler, path);
      expect(status).toBe(500);
      expect(body).toEqual({ success: false, error: message });
      expect(logger.error).toHaveBeenCalledTimes(1);
      const meta = vi.mocked(logger.error).mock.calls[0]![1];
      expect(meta).toEqual({ errorName: "Error" });
      expect(JSON.stringify(meta)).not.toContain(CLIENT);
    });
  });
});

// Kontrola pomocnika: wykrywa eq(salonId) tylko z właściwą wartością.
describe("kontrola testu: hasEqSalonId", () => {
  it("rozróżnia salon z query od innej wartości i od braku warunku", async () => {
    const { eq, and } = await import("drizzle-orm");
    const { promotions } = await import("@/lib/schema");
    expect(getTableName(promotions)).toBe("promotions");
    expect(hasEqSalonId(and(eq(promotions.salonId, SALON), eq(promotions.isActive, true)), "promotions")).toBe(true);
    expect(hasEqSalonId(eq(promotions.salonId, CLIENT), "promotions")).toBe(false);
    expect(hasEqSalonId(eq(promotions.isActive, true), "promotions")).toBe(false);
  });
});

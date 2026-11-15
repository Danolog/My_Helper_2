/**
 * Zamrożony typ promocji nie istnieje dla modelu (B2.1, Sophia wiersz 17,
 * Leo N1): rekomendacje tygodniowe nie liczą ani nie wymieniają promocji
 * pakietowych, 2+1, happy hours ani pierwszej wizyty. Filtr jest w SQL
 * (żeby zamrożone nie zajmowały miejsc w limit(5)) i w JS (druga linia).
 * Kontrola: po odmrożeniu w rejestrze filtr znika, a promocje wracają.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWeeklyRecommendations } from "@/lib/ai/business/weekly-recommendations";
import { MODULES } from "@/lib/features";
import { promotions } from "@/lib/schema";

const { promotionRows, notInArrayCalls } = vi.hoisted(() => ({
  promotionRows: [] as Array<{ id: string; name: string; type: string }>,
  notInArrayCalls: [] as unknown[][],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    notInArray: (...args: Parameters<typeof actual.notInArray>) => {
      notInArrayCalls.push(args);
      return actual.notInArray(...args);
    },
  };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: () => ({
    raw: (fn: (tx: unknown) => unknown) => {
      const tx = {
        select: () => {
          let table: unknown;
          const chain: Record<string, unknown> = {};
          for (const m of ["innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"]) {
            chain[m] = () => chain;
          }
          chain.from = (t: unknown) => {
            table = t;
            return chain;
          };
          chain.then = (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(table === promotions ? [...promotionRows] : []).then(resolve, reject);
          return chain;
        },
      };
      return fn(tx);
    },
  }),
}));

const ROWS = [
  { id: "p1", name: "Rabat -10%", type: "percentage", startDate: null, endDate: null },
  { id: "p2", name: "Pakiet 5 wizyt", type: "package", startDate: null, endDate: null },
  { id: "p3", name: "Happy hours", type: "happy_hours", startDate: null, endDate: null },
  { id: "p4", name: "Pierwsza wizyta", type: "first_visit", startDate: null, endDate: null },
  { id: "p5", name: "2+1", type: "buy2get1", startDate: null, endDate: null },
  { id: "p6", name: "Minus 20 zł", type: "fixed", startDate: null, endDate: null },
];

function promoRecommendation(result: Awaited<ReturnType<typeof generateWeeklyRecommendations>>) {
  return result.recommendations.find((r) => r.id === "active-promotions");
}

beforeEach(() => {
  promotionRows.length = 0;
  promotionRows.push(...ROWS);
  notInArrayCalls.length = 0;
});

describe("weekly-recommendations — zamrożone typy promocji", () => {
  it("model widzi tylko rabat procentowy i kwotowy", async () => {
    const rec = promoRecommendation(await generateWeeklyRecommendations("salon-1"));
    expect(rec?.title).toBe("2 aktywnych promocji w tym tygodniu");
    expect(rec?.description).toContain("Rabat -10%, Minus 20 zł.");
    for (const name of ["Pakiet 5 wizyt", "Happy hours", "Pierwsza wizyta", "2+1"]) {
      expect(rec?.description).not.toContain(name);
    }
  });

  it("filtr jest w SQL: notInArray na promotions.type z czterema zamrożonymi typami", async () => {
    await generateWeeklyRecommendations("salon-1");
    expect(notInArrayCalls).toHaveLength(1);
    const [column, values] = notInArrayCalls[0] as [unknown, string[]];
    expect(column).toBe(promotions.type);
    expect([...values].sort()).toEqual(["buy2get1", "first_visit", "happy_hours", "package"]);
  });

  it("same zamrożone promocje → brak rekomendacji o promocjach", async () => {
    promotionRows.length = 0;
    promotionRows.push(...ROWS.filter((r) => r.type !== "percentage" && r.type !== "fixed"));
    expect(promoRecommendation(await generateWeeklyRecommendations("salon-1"))).toBeUndefined();
  });

  it("kontrola: po odmrożeniu modułu w rejestrze wszystkie promocje wracają, bez filtra SQL", async () => {
    const entry = MODULES.find((m) => m.key === "complexPromotions") as {
      hardOff?: boolean | undefined;
    };
    const before = entry.hardOff;
    entry.hardOff = false;
    try {
      const rec = promoRecommendation(await generateWeeklyRecommendations("salon-1"));
      expect(rec?.title).toBe("6 aktywnych promocji w tym tygodniu");
      expect(notInArrayCalls).toHaveLength(0);
    } finally {
      entry.hardOff = before;
    }
  });
});

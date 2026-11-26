/**
 * Jeden nośnik reguły promocji złożonych.
 *
 * Zamrożenie typów promocji (`isPromotionTypeFrozen`) wynika z flagi
 * `hardOff` modułu `complexPromotions` w `src/lib/features.ts`. Test
 * symuluje odmrożenie dokładnie tak, jak zrobiłby to człowiek — zdjęciem
 * `hardOff` z wpisu w `MODULES` — i sprawdza, że WSZYSCY egzekutorzy
 * zmieniają zdanie razem: typy, proxy, bramka w trasie `check-happy-hours`
 * i zadatek liczony przez serwer. Do tego: przy odmrożeniu kwota zadatku
 * z `deposit-calculation` zgadza się z ceną, jaką portal policzy z odpowiedzi
 * `check-happy-hours` (ten sam wzór co `use-booking-data.ts`).
 *
 * Pozostałe trasy `check-*` (2+1, pakiet, pierwsza wizyta) nie wpływają na
 * zadatek z portalu: zadatek liczy tylko happy hours (pierwsza wizyta nie
 * jest naliczana od #27, 2+1 i pakiety rezerwuje panel, nie portal).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as checkHappyHours } from "@/app/api/promotions/check-happy-hours/route";
import { calculateExpectedDeposit } from "@/lib/deposit-calculation";
import {
  FROZEN_PROMOTION_TYPES,
  MODULES,
  frozenModuleForApiPath,
  isModuleFrozen,
  isPromotionTypeFrozen,
} from "@/lib/features";
import { frozenModuleResponse, frozenPromotionTypeResponse } from "@/lib/server/frozen-guard";

const { selectQueue } = vi.hoisted(() => ({ selectQueue: [] as unknown[][] }));

// Jedna kolejka wyników dla tx.select: trasa check-happy-hours i
// deposit-calculation czytają przez forSalon, czyli w db.transaction.
vi.mock("@/lib/db", () => {
  const select = () => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
      then: (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  const tx = { select, execute: async () => undefined };
  return {
    db: {
      select,
      transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Zadatek liczony tak, jak po jego włączeniu (isDepositEnabled); reszta
// rejestru prawdziwa — odmrożenie zmienia ten sam obiekt `MODULES`.
vi.mock("@/lib/features", async (orig) => ({
  ...(await orig<typeof import("@/lib/features")>()),
  isDepositEnabled: () => true,
}));

// UUID: trasa check-happy-hours odrzuca zły format salonId przed forSalon.
const SALON = "11111111-1111-4111-8111-111111111111";
// Poniedziałek 2026-07-06 14:00 w Warszawie (CEST) = 12:00Z.
const DATE = "2026-07-06";
const TIME_IN_WINDOW = "14:00";
const START_IN_WINDOW = new Date("2026-07-06T12:00:00Z");
// Ten sam dzień 20:30 w Warszawie — poza oknem 12:00–16:00.
const TIME_OUT_OF_WINDOW = "20:30";
const START_OUT_OF_WINDOW = new Date("2026-07-06T18:30:00Z");

const service = {
  id: "svc-1",
  name: "Strzyżenie",
  basePrice: "99.99",
  depositRequired: true,
  depositPercentage: 30,
};
const happyHours = (value: string) => ({
  id: `hh-${value}`,
  salonId: SALON,
  name: `Happy -${value}%`,
  type: "happy_hours",
  value,
  isActive: true,
  startDate: null,
  endDate: null,
  conditionsJson: { daysOfWeek: [1], startTime: "12:00", endTime: "16:00" },
});

/** Odmrożenie w rejestrze: zdjęcie `hardOff` z wpisu modułu, po teście przywrócenie. */
async function withComplexPromotionsUnfrozen<T>(fn: () => Promise<T> | T): Promise<T> {
  const entry = MODULES.find((m) => m.key === "complexPromotions") as { hardOff?: boolean | undefined };
  const before = entry.hardOff;
  entry.hardOff = false;
  try {
    return await fn();
  } finally {
    entry.hardOff = before;
  }
}

async function askHappyHours(time: string) {
  const res = await checkHappyHours(
    new Request(
      `http://localhost/api/promotions/check-happy-hours?salonId=${SALON}&date=${DATE}&time=${time}`
    )
  );
  return { status: res.status, body: await res.json() };
}

async function deposit(startTime: Date) {
  const result = await calculateExpectedDeposit({
    salonId: SALON,
    serviceId: "svc-1",
    startTime,
  });
  if (!result.ok) throw new Error(result.error);
  return result.amount;
}

/** Zadatek, jaki portal pokaże z odpowiedzi check-happy-hours (wzór z use-booking-data.ts). */
function portalDeposit(basePrice: string, discountPercent: number | null): number {
  const base = parseFloat(basePrice);
  const discount = discountPercent ? Math.round(base * discountPercent) / 100 : 0;
  return Math.ceil((base - discount) * (30 / 100));
}

beforeEach(() => {
  selectQueue.length = 0;
});

describe("stan dzisiejszy — moduł zamrożony", () => {
  it("typy, trasy i bramki mówią „zamrożone” jednym głosem", async () => {
    expect(isModuleFrozen("complexPromotions")).toBe(true);
    for (const type of FROZEN_PROMOTION_TYPES) {
      expect(isPromotionTypeFrozen(type), type).toBe(true);
      expect(frozenPromotionTypeResponse(type)?.status, type).toBe(400);
    }
    expect(frozenModuleForApiPath("/api/promotions/check-happy-hours")).toBe("complexPromotions");
    expect(frozenModuleForApiPath("/api/appointments/book-package")).toBe("complexPromotions");
    expect(frozenModuleResponse("complexPromotions")?.status).toBe(404);

    // Trasa 404, zadatek od pełnej ceny — bez pytania bazy o promocje.
    selectQueue.push([happyHours("20")]);
    expect((await askHappyHours(TIME_IN_WINDOW)).status).toBe(404);
    selectQueue.length = 0;
    selectQueue.push([service], [happyHours("20")]);
    expect(await deposit(START_IN_WINDOW)).toBe(portalDeposit(service.basePrice, null)); // 30
    expect(selectQueue).toEqual([[happyHours("20")]]);
  });
});

describe("odmrożenie w rejestrze — wszystko odmraża się razem", () => {
  it("typy przestają być zamrożone, trasy i bramki przepuszczają", async () => {
    await withComplexPromotionsUnfrozen(() => {
      expect(isModuleFrozen("complexPromotions")).toBe(false);
      for (const type of FROZEN_PROMOTION_TYPES) {
        expect(isPromotionTypeFrozen(type), type).toBe(false);
        expect(frozenPromotionTypeResponse(type), type).toBeNull();
      }
      expect(frozenModuleForApiPath("/api/promotions/check-happy-hours")).toBeNull();
      expect(frozenModuleForApiPath("/api/promotions/check-first-visit")).toBeNull();
      expect(frozenModuleForApiPath("/api/appointments/book-package")).toBeNull();
      expect(frozenModuleResponse("complexPromotions")).toBeNull();
      // Inne moduły bez zmian.
      expect(isModuleFrozen("imageGen")).toBe(true);
    });
    // Po teście rejestr wraca do stanu z repo.
    expect(isPromotionTypeFrozen("happy_hours")).toBe(true);
  });

  it.each([
    ["w oknie happy hours", TIME_IN_WINDOW, START_IN_WINDOW, 20],
    ["poza oknem", TIME_OUT_OF_WINDOW, START_OUT_OF_WINDOW, null],
  ] as const)(
    "%s: zadatek z serwera = zadatek, który portal policzy z check-happy-hours",
    async (_label, time, startTime, expectedPercent) => {
      await withComplexPromotionsUnfrozen(async () => {
        selectQueue.push([happyHours("10"), happyHours("20")]);
        const { status, body } = await askHappyHours(time);
        expect(status).toBe(200);
        const percent = body.data.eligible ? body.data.discountPercent : null;
        expect(percent).toBe(expectedPercent);

        selectQueue.push([service], [happyHours("10"), happyHours("20")]);
        const serverAmount = await deposit(startTime);

        expect(serverAmount).toBe(portalDeposit(service.basePrice, percent));
      });
    }
  );

  it("kontrola: w oknie rabat faktycznie zmienia zadatek (99.99 → 24, nie 30)", async () => {
    await withComplexPromotionsUnfrozen(async () => {
      selectQueue.push([service], [happyHours("20")]);
      expect(await deposit(START_IN_WINDOW)).toBe(24);
    });
  });
});

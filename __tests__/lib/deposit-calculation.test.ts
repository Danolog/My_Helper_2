/**
 * Serwerowe liczenie kwoty zadatku (SECURITY) — kwota NIGDY nie pochodzi
 * z request body; calculateExpectedDeposit odtwarza ja po stronie serwera
 * (lustro logiki frontendu use-booking-data):
 *   - cena = basePrice + variant.priceModifier,
 *   - najlepszy JEDEN rabat (happy hours vs pierwsza wizyta, bez stackowania),
 *   - ustawienia zadatku klienta (fixed/percentage) nadpisuja ustawienia uslugi,
 *   - procent uslugi liczony z Math.ceil (zaokraglenie W GORE — na korzysc salonu).
 *
 * Mock db: kazde wywolanie db.select().from().where() zjada kolejny wynik
 * z kolejki (funkcje pomocnicze wolaja db wielokrotnie); `.limit(1)` na
 * wyniku where (lookup klienta) zwraca ten sam wynik.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectQueue, mockDbSelect } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDbSelectWhere = vi.fn(() => {
    const result = selectQueue.length > 0 ? selectQueue.shift()! : [];
    const thenable = Promise.resolve(result) as Promise<unknown[]> & {
      limit: (n: number) => Promise<unknown[]>;
    };
    thenable.limit = () => Promise.resolve(result);
    return thenable;
  });
  const mockDbSelectFrom = vi.fn(() => ({ where: mockDbSelectWhere }));
  const mockDbSelect = vi.fn((..._args: unknown[]) => ({ from: mockDbSelectFrom }));
  return { selectQueue, mockDbSelect, mockDbSelectFrom, mockDbSelectWhere };
});

vi.mock("@/lib/db", () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

vi.mock("@/lib/schema", () => ({
  services: {
    id: "services.id",
    name: "services.name",
    salonId: "services.salonId",
    basePrice: "services.basePrice",
    depositRequired: "services.depositRequired",
    depositPercentage: "services.depositPercentage",
  },
  serviceVariants: {
    id: "serviceVariants.id",
    serviceId: "serviceVariants.serviceId",
    priceModifier: "serviceVariants.priceModifier",
  },
  promotions: {
    salonId: "promotions.salonId",
    type: "promotions.type",
    isActive: "promotions.isActive",
  },
  clients: {
    id: "clients.id",
    salonId: "clients.salonId",
    email: "clients.email",
    requireDeposit: "clients.requireDeposit",
    depositType: "clients.depositType",
    depositValue: "clients.depositValue",
  },
  appointments: {
    salonId: "appointments.salonId",
    clientId: "appointments.clientId",
    status: "appointments.status",
    bookedByUserId: "appointments.bookedByUserId",
  },
}));

import { calculateExpectedDeposit } from "@/lib/deposit-calculation";

/** Zaplanuj kolejne wyniki db.select().from().where() (FIFO). */
function queueSelect(...results: unknown[][]) {
  selectQueue.push(...results);
}

// 2026-07-06T12:00:00Z = poniedzialek 14:00 czasu Europe/Warsaw (CEST, UTC+2).
const MONDAY_1400_WARSAW = new Date("2026-07-06T12:00:00Z");
// 2026-07-06T18:30:00Z = poniedzialek 20:30 w Warszawie (poza oknem 12-16).
const MONDAY_2030_WARSAW = new Date("2026-07-06T18:30:00Z");
// 2026-07-07T12:00:00Z = wtorek 14:00 w Warszawie.
const TUESDAY_1400_WARSAW = new Date("2026-07-07T12:00:00Z");

const baseService = {
  id: "svc-1",
  name: "Strzyzenie",
  basePrice: "100.00",
  depositRequired: true,
  depositPercentage: 30,
};

const happyHoursPromo = (value: string, overrides: Record<string, unknown> = {}) => ({
  value,
  startDate: null,
  endDate: null,
  conditionsJson: { daysOfWeek: [1], startTime: "12:00", endTime: "16:00" },
  ...overrides,
});

const firstVisitPromo = (value: string, overrides: Record<string, unknown> = {}) => ({
  value,
  startDate: null,
  endDate: null,
  conditionsJson: {},
  ...overrides,
});

const baseParams = {
  salonId: "salon-1",
  serviceId: "svc-1",
  startTime: MONDAY_1400_WARSAW,
};

describe("calculateExpectedDeposit — walidacja usluga/wariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("zwraca service_not_found, gdy usluga nie istnieje w salonie", async () => {
    queueSelect([]);

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toEqual({ ok: false, error: "service_not_found" });
  });

  it("zwraca variant_not_found, gdy wariant nie nalezy do uslugi", async () => {
    queueSelect([baseService], []);

    const result = await calculateExpectedDeposit({
      ...baseParams,
      variantId: "var-obcy",
    });
    expect(result).toEqual({ ok: false, error: "variant_not_found" });
  });
});

describe("calculateExpectedDeposit — zadatek procentowy uslugi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("liczy procent uslugi z Math.ceil (99.99 * 30% = 29.997 -> 30)", async () => {
    queueSelect([{ ...baseService, basePrice: "99.99" }], /* happy hours */ []);

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toEqual({
      ok: true,
      required: true,
      amount: 30,
      serviceName: "Strzyzenie",
    });
  });

  it("uzywa DEFAULT_DEPOSIT_PERCENTAGE (30%), gdy usluga nie ma wlasnego procentu", async () => {
    queueSelect([{ ...baseService, depositPercentage: null }], []);

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toMatchObject({ ok: true, required: true, amount: 30 });
  });

  it("required=false i amount=0, gdy usluga nie wymaga zadatku i klient tez nie", async () => {
    queueSelect([{ ...baseService, depositRequired: false }], []);

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toEqual({
      ok: true,
      required: false,
      amount: 0,
      serviceName: "Strzyzenie",
    });
  });

  it("dolicza priceModifier wariantu do ceny bazowej (100 + 50 -> 30% z 150 = 45)", async () => {
    queueSelect(
      [baseService],
      [{ id: "var-1", priceModifier: "50.00" }],
      /* happy hours */ []
    );

    const result = await calculateExpectedDeposit({ ...baseParams, variantId: "var-1" });
    expect(result).toMatchObject({ ok: true, required: true, amount: 45 });
  });

  it("wariant z priceModifier=null nie zmienia ceny", async () => {
    queueSelect([baseService], [{ id: "var-1", priceModifier: null }], []);

    const result = await calculateExpectedDeposit({ ...baseParams, variantId: "var-1" });
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });
});

describe("calculateExpectedDeposit — rabat happy hours (Europe/Warsaw)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("stosuje rabat, gdy rezerwacja wpada w okno czasowe i dzien tygodnia", async () => {
    // Poniedzialek 14:00 Warszawa, okno pn 12:00-16:00, rabat 20%.
    queueSelect([baseService], [happyHoursPromo("20")]);

    const result = await calculateExpectedDeposit(baseParams);
    // 100 - 20% = 80; ceil(80 * 30%) = 24
    expect(result).toMatchObject({ ok: true, amount: 24 });
  });

  it("nie stosuje rabatu poza oknem godzinowym (20:30 przy oknie 12-16)", async () => {
    queueSelect([baseService], [happyHoursPromo("20")]);

    const result = await calculateExpectedDeposit({
      ...baseParams,
      startTime: MONDAY_2030_WARSAW,
    });
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("nie stosuje rabatu w innym dniu tygodnia (wtorek przy daysOfWeek=[pon])", async () => {
    queueSelect([baseService], [happyHoursPromo("20")]);

    const result = await calculateExpectedDeposit({
      ...baseParams,
      startTime: TUESDAY_1400_WARSAW,
    });
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("pomija promocje przed startDate i po endDate", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    queueSelect(
      [baseService],
      [
        happyHoursPromo("20", { startDate: future }), // jeszcze nie wystartowala
        happyHoursPromo("25", { endDate: past }), // juz wygasla
      ]
    );

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("pomija promocje bez kompletnego okna czasowego (brak endTime)", async () => {
    queueSelect(
      [baseService],
      [
        happyHoursPromo("20", {
          conditionsJson: { daysOfWeek: [1], startTime: "12:00" },
        }),
      ]
    );

    const result = await calculateExpectedDeposit(baseParams);
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("z kilku pasujacych promocji wybiera najwyzszy rabat", async () => {
    queueSelect([baseService], [happyHoursPromo("10"), happyHoursPromo("25")]);

    const result = await calculateExpectedDeposit(baseParams);
    // 100 - 25% = 75; ceil(75 * 30%) = ceil(22.5) = 23
    expect(result).toMatchObject({ ok: true, amount: 23 });
  });
});

describe("calculateExpectedDeposit — rabat pierwszej wizyty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("stosuje rabat dla goscia bez zadnych wizyt (0 w clients i 0 w portalu)", async () => {
    queueSelect(
      [baseService],
      /* happy hours */ [],
      /* first_visit promocje */ [firstVisitPromo("15")],
      /* clientRecords po emailu */ [],
      /* portalCount */ [{ count: 0 }]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      guestEmail: "nowy@example.com",
    });
    // 100 - 15% = 85; ceil(85 * 30%) = ceil(25.5) = 26
    expect(result).toMatchObject({ ok: true, amount: 26 });
  });

  it("nie stosuje rabatu, gdy klient ma juz wizyty w kartotece", async () => {
    queueSelect(
      [baseService],
      [],
      [firstVisitPromo("15")],
      /* clientRecords */ [{ id: "client-1" }],
      /* count wizyt klienta */ [{ count: 2 }],
      /* portalCount */ [{ count: 0 }]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      guestEmail: "staly@example.com",
    });
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("nie stosuje rabatu, gdy klient rezerwowal wczesniej przez portal (bez kartoteki)", async () => {
    queueSelect(
      [baseService],
      [],
      [firstVisitPromo("15")],
      /* clientRecords */ [],
      /* portalCount */ [{ count: 1 }]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      guestEmail: "portalowy@example.com",
    });
    expect(result).toMatchObject({ ok: true, amount: 30 });
  });

  it("wygasla promocja first_visit => brak rabatu bez liczenia wizyt", async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    queueSelect([baseService], [], [firstVisitPromo("15", { endDate: past })]);

    const result = await calculateExpectedDeposit({
      ...baseParams,
      guestEmail: "ktos@example.com",
    });
    expect(result).toMatchObject({ ok: true, amount: 30 });
    // validPromotions puste => zadnych dalszych selectow (kolejka zjedzona w calosci)
    expect(selectQueue).toHaveLength(0);
  });
});

describe("calculateExpectedDeposit — best-of rabatow (bez stackowania)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("wybiera JEDEN wyzszy rabat: happy hours 20% > first visit 10%", async () => {
    queueSelect(
      [baseService],
      /* happy hours */ [happyHoursPromo("20")],
      /* first_visit */ [firstVisitPromo("10")],
      /* clientRecords (first visit) */ [],
      /* portalCount */ [{ count: 0 }],
      /* ustawienia zadatku klienta */ []
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      sessionEmail: "user@example.com",
    });
    // max(20, 10) = 20 (NIE 30 sumarycznie); 100 - 20 = 80; ceil(80 * 30%) = 24
    expect(result).toMatchObject({ ok: true, amount: 24 });
  });
});

describe("calculateExpectedDeposit — ustawienia zadatku klienta (nadpisuja usluge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it("zadatek fixed klienta wymusza zadatek, nawet gdy usluga go nie wymaga", async () => {
    queueSelect(
      [{ ...baseService, depositRequired: false }],
      /* happy hours */ [],
      /* first_visit */ [],
      /* klient */ [
        { requireDeposit: true, depositType: "fixed", depositValue: "20.50" },
      ]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      sessionEmail: "vip@example.com",
    });
    expect(result).toEqual({
      ok: true,
      required: true,
      amount: 20.5,
      serviceName: "Strzyzenie",
    });
  });

  it("procent klienta nadpisuje procent uslugi (50% zamiast 30%)", async () => {
    queueSelect(
      [baseService],
      [],
      [],
      [{ requireDeposit: true, depositType: "percentage", depositValue: "50" }]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      sessionEmail: "ryzykowny@example.com",
    });
    // ceil(100 * 50%) = 50, a nie 30 z uslugi
    expect(result).toMatchObject({ ok: true, required: true, amount: 50 });
  });

  it("requireDeposit klienta z wartoscia 0 => required=true, ale kwota 0 (usluga bez zadatku)", async () => {
    queueSelect(
      [{ ...baseService, depositRequired: false }],
      [],
      [],
      [{ requireDeposit: true, depositType: "percentage", depositValue: "0" }]
    );

    const result = await calculateExpectedDeposit({
      ...baseParams,
      sessionEmail: "zero@example.com",
    });
    expect(result).toMatchObject({ ok: true, required: true, amount: 0 });
  });

  it("brak kartoteki klienta => obowiazuja ustawienia uslugi", async () => {
    queueSelect([baseService], [], [], /* klient nie znaleziony */ []);

    const result = await calculateExpectedDeposit({
      ...baseParams,
      sessionEmail: "nieznany@example.com",
    });
    expect(result).toMatchObject({ ok: true, required: true, amount: 30 });
  });
});

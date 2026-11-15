/**
 * Strażnik G5 (brief B, krok B2) — promocje złożone są zamrożone.
 *
 * Nośnik reguły: `FROZEN_PROMOTION_TYPES` w `src/lib/features.ts`
 * (happy hours, pakiet, 2+1, pierwsza wizyta). Ten plik pilnuje, że:
 * - `POST /api/promotions` z typem zamrożonym → 400, bez zapisu,
 * - `PUT /api/promotions/[id]` nie zmienia typu na zamrożony i nie edytuje
 *   (ani nie „odmraża” zmianą typu) promocji zamrożonej,
 * - `GET /api/promotions` i `GET /api/promotions/[id]` ich nie zwracają,
 * - rabat z zamrożonej promocji nie jest naliczany: zadatek liczony przez
 *   serwer nie zawiera rabatu happy hours (baza nie jest o nie pytana),
 *   a kod rabatowy powiązany z promocją zamrożoną jest nieważny.
 *
 * Typy brane są z rejestru — test iteruje po `FROZEN_PROMOTION_TYPES`, więc
 * zdjęcie typu z listy (np. „package”) czerwieni sprawdzenie dokładnego
 * zbioru, a dopisanie nowego typu do schematu bez decyzji — sprawdzenie
 * typów dozwolonych.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getOne, PUT } from "@/app/api/promotions/[id]/route";
import { POST as validateCode } from "@/app/api/promo-codes/validate/route";
import { GET, POST } from "@/app/api/promotions/route";
import { calculateExpectedDeposit } from "@/lib/deposit-calculation";
import { FROZEN_PROMOTION_TYPES, isPromotionTypeFrozen } from "@/lib/features";
import { SALON_A } from "../api/salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("../api/salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "owner-a" } }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

const ALL_SCHEMA_TYPES = ["percentage", "fixed", "package", "buy2get1", "happy_hours", "first_visit"];

/** Najmniejsze ciało, które przeszłoby walidację dla danego typu. */
function bodyFor(type: string): Record<string, unknown> {
  const base = { salonId: SALON_A, name: `Promo ${type}`, type, value: 20 };
  if (type === "package") {
    return { ...base, value: 150, conditionsJson: { packageServiceIds: ["s1", "s2"] } };
  }
  if (type === "happy_hours") {
    return { ...base, conditionsJson: { startTime: "10:00", endTime: "12:00", daysOfWeek: [1] } };
  }
  return base;
}

function create(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function update(id: string, body: Record<string, unknown>) {
  return PUT(
    new Request(`http://localhost/api/promotions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

const row = (id: string, type: string) => ({
  id,
  salonId: SALON_A,
  name: `Promo ${type}`,
  type,
  value: "20",
  startDate: null,
  endDate: null,
  conditionsJson: {},
  isActive: true,
  createdAt: "2026-11-01T00:00:00.000Z",
});

beforeEach(() => m.reset());

describe("rejestr typów zamrożonych", () => {
  it("zamrożone są dokładnie: happy hours, pakiet, 2+1, pierwsza wizyta", () => {
    expect([...FROZEN_PROMOTION_TYPES].sort()).toEqual(
      ["buy2get1", "first_visit", "happy_hours", "package"]
    );
  });

  it("dozwolone zostają tylko rabat procentowy i kwotowy", () => {
    expect(ALL_SCHEMA_TYPES.filter((t) => !isPromotionTypeFrozen(t))).toEqual([
      "percentage",
      "fixed",
    ]);
  });

  it.each([undefined, null, 1, "", "PACKAGE"])("wartość spoza listy %s nie jest zamrożona", (v) => {
    expect(isPromotionTypeFrozen(v)).toBe(false);
  });
});

describe("POST /api/promotions — typ zamrożony", () => {
  it.each(FROZEN_PROMOTION_TYPES)("%s → 400 PROMOTION_TYPE_DISABLED, bez zapisu", async (type) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row("p-new", type)]);

    const res = await create(bodyFor(type));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: "PROMOTION_TYPE_DISABLED" });
    expect(m.insertedValues).toEqual([]);
  });

  it.each(["percentage", "fixed"])("%s nadal się tworzy (201)", async (type) => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([row("p-new", type)]);

    const res = await create(bodyFor(type));

    expect(res.status).toBe(201);
    expect(m.insertedValues).toEqual([expect.objectContaining({ salonId: SALON_A, type })]);
  });
});

describe("GET /api/promotions — typy zamrożone nie są zwracane", () => {
  it("lista zawiera tylko rabaty procentowe i kwotowe, count się zgadza", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      row("p-pct", "percentage"),
      ...FROZEN_PROMOTION_TYPES.map((t) => row(`p-${t}`, t)),
      row("p-fix", "fixed"),
    ]);

    const res = await GET(new Request("http://localhost/api/promotions"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(["p-pct", "p-fix"]);
    expect(body.count).toBe(2);
  });
});

describe("GET/PUT /api/promotions/[id] — promocja zamrożona nie istnieje dla panelu", () => {
  it.each(FROZEN_PROMOTION_TYPES)("GET promocji %s → 404", async (type) => {
    m.txRows.push([row("p-1", type)]);
    const res = await getOne(new Request("http://localhost/api/promotions/p-1"), {
      params: Promise.resolve({ id: "p-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET promocji procentowej → 200 (kontrola)", async () => {
    m.txRows.push([row("p-1", "percentage")]);
    const res = await getOne(new Request("http://localhost/api/promotions/p-1"), {
      params: Promise.resolve({ id: "p-1" }),
    });
    expect(res.status).toBe(200);
  });

  it.each(FROZEN_PROMOTION_TYPES)("PUT zmiana typu na %s → 400, bez odczytu i zapisu", async (type) => {
    m.txRows.push([row("p-1", "percentage")], [row("p-1", type)]);
    const res = await update("p-1", { type });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("PROMOTION_TYPE_DISABLED");
    // Obie kolejki wyników nietknięte: trasa nie czytała ani nie pisała.
    expect(m.txRows).toHaveLength(2);
  });

  it.each(FROZEN_PROMOTION_TYPES)(
    "PUT promocji %s (włączenie albo zmiana typu na dozwolony) → 404, bez zapisu",
    async (type) => {
      m.txRows.push([row("p-1", type)], [row("p-1", "percentage")]);
      const res = await update("p-1", { type: "percentage", isActive: true });
      expect(res.status).toBe(404);
      // Odczytany tylko istniejący wiersz; wynik zapisu nieużyty.
      expect(m.txRows).toHaveLength(1);
    }
  );

  it("PUT promocji procentowej → 200 (kontrola)", async () => {
    m.txRows.push([row("p-1", "percentage")], [{ ...row("p-1", "percentage"), name: "Nowa" }]);
    const res = await update("p-1", { name: "Nowa" });
    expect(res.status).toBe(200);
  });
});

describe("zadatek liczony przez serwer — bez rabatu happy hours", () => {
  // 2026-07-06T12:00:00Z = poniedziałek 14:00 w Warszawie — w oknie promocji.
  const MONDAY_1400_WARSAW = new Date("2026-07-06T12:00:00Z");
  const service = {
    id: "svc-1",
    name: "Strzyżenie",
    basePrice: "100.00",
    depositRequired: true,
    depositPercentage: 30,
  };
  const happyHours = {
    ...row("p-hh", "happy_hours"),
    value: "50",
    conditionsJson: { daysOfWeek: [1], startTime: "12:00", endTime: "16:00" },
  };

  it("rezerwacja w oknie happy hours → zadatek od pełnej ceny, bez zapytania o promocje", async () => {
    // Kolejka wyników db.select(): usługa, a gdyby trasa zapytała — promocja -50%.
    const results: unknown[][] = [[service], [happyHours]];
    const select = vi.spyOn(m.db, "select").mockImplementation((() => {
      const rows = results.shift() ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: async () => rows,
        then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    }) as unknown as typeof m.db.select);

    try {
      const result = await calculateExpectedDeposit({
        salonId: SALON_A,
        serviceId: "svc-1",
        startTime: MONDAY_1400_WARSAW,
      });

      // 30% z pełnych 100 zł = 30 (z rabatem 50% byłoby 15).
      expect(result).toEqual({ ok: true, required: true, amount: 30, serviceName: "Strzyżenie" });
      // Tylko zapytanie o usługę — promocja happy hours została w kolejce.
      expect(select).toHaveBeenCalledTimes(1);
      expect(results).toEqual([[happyHours]]);
    } finally {
      select.mockRestore();
    }
  });
});

describe("POST /api/promo-codes/validate — kod powiązany z promocją zamrożoną", () => {
  const promoCode = {
    id: "pc-1",
    salonId: SALON_A,
    code: "LATO",
    promotionId: "p-1",
    usageLimit: null,
    usedCount: 0,
    expiresAt: null,
  };

  function validate() {
    return validateCode(
      new Request("http://localhost/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "lato", salonId: SALON_A }),
      })
    );
  }

  it.each(FROZEN_PROMOTION_TYPES)("promocja %s → kod nieważny, bez rabatu", async (type) => {
    m.txRows.push([{ promoCode, promotion: row("p-1", type) }]);
    const res = await validate();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.valid).toBe(false);
    expect(body.data).not.toHaveProperty("discountType");
    expect(body.data).not.toHaveProperty("discountValue");
  });

  it("promocja procentowa → kod ważny z rabatem (kontrola)", async () => {
    m.txRows.push([{ promoCode, promotion: row("p-1", "percentage") }]);
    const res = await validate();
    const body = await res.json();

    expect(body.data).toMatchObject({ valid: true, discountType: "percentage", discountValue: 20 });
  });
});

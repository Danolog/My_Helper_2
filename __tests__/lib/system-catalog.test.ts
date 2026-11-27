// @vitest-environment node
/**
 * Publiczna lista salonów (`listPublicSalonCatalog`, pula systemowa).
 *
 * Atrapa `dbSystem` odnotowuje każde zapytanie (tabela, lista kolumn, WHERE,
 * GROUP BY) i oddaje wiersze z kolejki. Operatory drizzle to atrapy
 * `{ type, args }`, kolumny napisami `tabela.kolumna` — testy sprawdzają
 * zbudowane warunki i listy kolumn, a nie tylko wynik.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface Query {
  table: string;
  cols: Record<string, unknown> | null;
  where: unknown;
  groupBy: unknown[];
  limit?: number;
}

const queries: Query[] = [];
/** Wyniki kolejnych zapytań (FIFO); Error = odrzucenie. */
const results: (Row[] | Error)[] = [];

vi.mock("drizzle-orm", () => {
  const node = (type: string) => (...args: unknown[]) => ({ type, args });
  return {
    and: node("and"),
    eq: node("eq"),
    ne: node("ne"),
    isNotNull: node("isNotNull"),
    inArray: node("inArray"),
    count: node("count"),
    avg: node("avg"),
    like: node("like"),
    or: node("or"),
  };
});

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, p) => (p === "_table" ? name : typeof p === "symbol" ? undefined : `${name}.${String(p)}`) });
  return { salons: table("salons"), services: table("services"), reviews: table("reviews") };
});

vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (cols?: Record<string, unknown>) => {
      const q: Query = { table: "", cols: cols ?? null, where: undefined, groupBy: [] };
      queries.push(q);
      const chain = {
        from(t: { _table: string }) {
          q.table = t._table;
          return chain;
        },
        where(w: unknown) {
          q.where = w;
          return chain;
        },
        groupBy(...g: unknown[]) {
          q.groupBy = g;
          return chain;
        },
        limit(n: number) {
          q.limit = n;
          return chain;
        },
        then(resolve: (r: Row[]) => unknown, reject: (e: unknown) => unknown) {
          const next = results.shift() ?? [];
          return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

/**
 * Moduł opinii jest zamrożony (`hardOff` w `src/lib/features.ts`). Oceny
 * w katalogu testujemy z flagą podmienioną na włączoną; blok „moduł opinii
 * zamrożony” sprawdza listę bez ocen.
 */
const frozenState = vi.hoisted(() => ({ unfreezeReviews: true }));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      frozenState.unfreezeReviews && key === "reviews" ? false : actual.isModuleFrozen(key),
  };
});

import { findPublicSalonIdBySlug, listPublicSalonCatalog, pickFreeSalonSlug } from "@/lib/server/system/catalog";

const node = (type: string, ...args: unknown[]) => ({ type, args });

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALON_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const salon = (id: string, name: string) => ({
  id, name, phone: "+48500000000", email: `${name}@example.com`, address: "Ul. Testowa 1", industryType: "spa",
});

beforeEach(() => {
  queries.length = 0;
  results.length = 0;
  frozenState.unfreezeReviews = true;
});

describe("listPublicSalonCatalog — moduł opinii zamrożony", () => {
  it("bez zapytania o opinie; ocena null i liczba opinii 0", async () => {
    frozenState.unfreezeReviews = false;
    results.push([salon(SALON_A, "A")], [{ salonId: SALON_A, serviceCount: 2 }]);

    const list = await listPublicSalonCatalog();

    expect(queries.map((q) => q.table)).toEqual(["salons", "services"]);
    expect(list).toEqual([
      { ...salon(SALON_A, "A"), serviceCount: 2, averageRating: null, reviewCount: 0 },
    ]);
  });
});

describe("listPublicSalonCatalog", () => {
  it("salony czytane jawną listą kolumn DTO — bez settingsJson i ownerId", async () => {
    results.push([]);
    await listPublicSalonCatalog();
    expect(queries[0]!.table).toBe("salons");
    expect(queries[0]!.cols).toEqual({
      id: "salons.id",
      name: "salons.name",
      phone: "salons.phone",
      email: "salons.email",
      address: "salons.address",
      industryType: "salons.industryType",
    });
    const cols = Object.values(queries[0]!.cols ?? {});
    expect(cols).not.toContain("salons.settingsJson");
    expect(cols).not.toContain("salons.ownerId");
  });

  it("filtry: adres, telefon i branża niepuste; usługi aktywne; tylko opinie approved", async () => {
    results.push([salon(SALON_A, "A")], [], []);
    await listPublicSalonCatalog();
    expect(queries.map((q) => q.table)).toEqual(["salons", "services", "reviews"]);
    expect(queries[0]!.where).toEqual(
      node(
        "and",
        node("isNotNull", "salons.address"),
        node("ne", "salons.address", ""),
        node("isNotNull", "salons.phone"),
        node("ne", "salons.phone", ""),
        node("isNotNull", "salons.industryType"),
        node("ne", "salons.industryType", "")
      )
    );
    expect(queries[1]!.where).toEqual(
      node("and", node("inArray", "services.salonId", [SALON_A]), node("eq", "services.isActive", true))
    );
    expect(queries[1]!.groupBy).toEqual(["services.salonId"]);
    expect(queries[2]!.where).toEqual(
      node("and", node("inArray", "reviews.salonId", [SALON_A]), node("eq", "reviews.status", "approved"))
    );
    expect(queries[2]!.groupBy).toEqual(["reviews.salonId"]);
    // Agregaty bez select() całego wiersza.
    expect(queries.every((q) => q.cols !== null)).toBe(true);
  });

  it("agregaty i sortowanie: salony z usługami najpierw, średnia zaokrąglona do 0,1, brak danych = 0/null", async () => {
    results.push(
      [salon(SALON_A, "A"), salon(SALON_B, "B"), salon(SALON_C, "C")],
      [
        { salonId: SALON_B, serviceCount: 3 },
        { salonId: SALON_C, serviceCount: "2" },
      ],
      [{ salonId: SALON_B, averageRating: "4.3333333333", reviewCount: "3" }]
    );
    const list = await listPublicSalonCatalog();
    expect(list).toEqual([
      { ...salon(SALON_B, "B"), serviceCount: 3, averageRating: 4.3, reviewCount: 3 },
      { ...salon(SALON_C, "C"), serviceCount: 2, averageRating: null, reviewCount: 0 },
      { ...salon(SALON_A, "A"), serviceCount: 0, averageRating: null, reviewCount: 0 },
    ]);
    for (const entry of list) {
      expect(entry).not.toHaveProperty("settingsJson");
      expect(entry).not.toHaveProperty("ownerId");
    }
  });

  it("pusta lista salonów → [] bez zapytań o usługi i opinie", async () => {
    results.push([]);
    expect(await listPublicSalonCatalog()).toEqual([]);
    expect(queries.map((q) => q.table)).toEqual(["salons"]);
  });

  it("błąd bazy przechodzi do wołającego (pierwsze i dalsze zapytanie)", async () => {
    results.push(new Error("db down"));
    await expect(listPublicSalonCatalog()).rejects.toThrow("db down");

    results.length = 0;
    results.push([salon(SALON_A, "A")], new Error("services down"));
    await expect(listPublicSalonCatalog()).rejects.toThrow("services down");
  });
});

describe("findPublicSalonIdBySlug — krótki adres /s/<slug>", () => {
  it("salon o tym slugu → jego id; zapytanie czyta tylko id, warunek równości, limit 1", async () => {
    results.push([{ id: SALON_A }]);

    expect(await findPublicSalonIdBySlug("salon-ada")).toBe(SALON_A);

    expect(queries).toHaveLength(1);
    expect(queries[0]!.table).toBe("salons");
    expect(queries[0]!.cols).toEqual({ id: "salons.id" });
    expect(queries[0]!.where).toEqual(node("eq", "salons.slug", "salon-ada"));
    expect(queries[0]!.limit).toBe(1);
  });

  it("nieznany slug → null", async () => {
    results.push([]);
    expect(await findPublicSalonIdBySlug("nie-ma-takiego")).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it("wielkie litery z adresu sprowadzane do małych", async () => {
    results.push([{ id: SALON_B }]);
    expect(await findPublicSalonIdBySlug("Salon-ADA")).toBe(SALON_B);
    expect(queries[0]!.where).toEqual(node("eq", "salons.slug", "salon-ada"));
  });

  it.each([
    ["za krótki", "ab"],
    ["za długi", "x".repeat(51)],
    ["zły format", "salon_ada"],
    ["wzorzec SQL", "salon%"],
    ["zastrzeżony", "admin"],
    ["ścieżka", "../salons"],
    ["pusty", ""],
  ])("%s (%s) → null bez zapytania do bazy", async (_name, slug) => {
    expect(await findPublicSalonIdBySlug(slug)).toBeNull();
    expect(queries).toEqual([]);
  });

  it("bez kolumn prywatnych w zapytaniu (settingsJson, ownerId)", async () => {
    results.push([{ id: SALON_A }]);
    await findPublicSalonIdBySlug("salon-ada");
    const cols = Object.values(queries[0]!.cols ?? {});
    expect(cols).not.toContain("salons.settingsJson");
    expect(cols).not.toContain("salons.ownerId");
  });

  it("błąd bazy przechodzi do wołającego", async () => {
    results.push(new Error("db down"));
    await expect(findPublicSalonIdBySlug("salon-ada")).rejects.toThrow("db down");
  });
});

describe("pickFreeSalonSlug — wolny adres dla zakładanego salonu", () => {
  it("adres wolny → base; zapytanie czyta tylko kolumnę slug, warunek base albo base-%", async () => {
    results.push([]);

    expect(await pickFreeSalonSlug("salon-ada")).toBe("salon-ada");

    expect(queries).toHaveLength(1);
    expect(queries[0]!.table).toBe("salons");
    expect(queries[0]!.cols).toEqual({ slug: "salons.slug" });
    expect(queries[0]!.where).toEqual(
      node("or", node("eq", "salons.slug", "salon-ada"), node("like", "salons.slug", "salon-ada-%"))
    );
  });

  it("base i base-2 zajęte → base-3", async () => {
    results.push([{ slug: "salon-ada" }, { slug: "salon-ada-2" }]);
    expect(await pickFreeSalonSlug("salon-ada")).toBe("salon-ada-3");
  });

  it("zajęty tylko sufiks (base wolny) → base", async () => {
    results.push([{ slug: "salon-ada-2" }]);
    expect(await pickFreeSalonSlug("salon-ada")).toBe("salon-ada");
  });

  it.each([
    ["wzorzec LIKE %", "salon%"],
    ["wzorzec LIKE _", "salon_ada"],
    ["za krótki", "ab"],
    ["zastrzeżony", "admin"],
  ])("niepoprawny base (%s: %s) → błąd bez zapytania", async (_name, base) => {
    await expect(pickFreeSalonSlug(base)).rejects.toThrow("not a valid salon slug");
    expect(queries).toEqual([]);
  });

  it("błąd bazy przechodzi do wołającego", async () => {
    results.push(new Error("db down"));
    await expect(pickFreeSalonSlug("salon-ada")).rejects.toThrow("db down");
  });
});

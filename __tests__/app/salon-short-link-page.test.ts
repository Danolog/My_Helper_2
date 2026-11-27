// @vitest-environment node
/**
 * Strona `/s/[slug]` (`src/app/s/[slug]/page.tsx`) razem z prawdziwym
 * `findPublicSalonIdBySlug` (wyjście systemowe). Atrapy: pula systemowa
 * (wiersze `salons` i rejestru `salon_slug_history` w pamięci), schemat,
 * operatory drizzle i `next/navigation` (redirect/notFound rzucają jak w Next).
 *
 * Sprawdza: adres bieżący → salon; dawny adres po zmianie → ten sam salon
 * (stare linki z Instagrama działają); nieznany adres → 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Cond = { type: string; args: unknown[] };

const db = vi.hoisted(() => ({
  salons: [] as { id: string; slug: string }[],
  history: [] as { slug: string; salonId: string; retiredAt: Date | null }[],
}));

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: nav.redirect, notFound: nav.notFound }));

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
  return {
    salons: table("salons"),
    services: table("services"),
    reviews: table("reviews"),
    salonSlugHistory: table("salonSlugHistory"),
  };
});

/** Pula systemowa: obsługuje tylko `select(cols).from(t).where(eq(kolumna, wartość)).limit(n)`. */
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (cols: Record<string, string>) => {
      let table = "";
      let where: Cond | undefined;
      const chain = {
        from(t: { _table: string }) {
          table = t._table;
          return chain;
        },
        where(w: Cond) {
          where = w;
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve: (r: Record<string, unknown>[]) => unknown, reject: (e: unknown) => unknown) {
          if (where?.type !== "eq") return Promise.reject(new Error("atrapa: tylko eq")).then(resolve, reject);
          const [column, value] = where.args as [string, unknown];
          const field = column.split(".")[1]!;
          const source: Record<string, unknown>[] = table === "salons" ? db.salons : db.history;
          const rows = source
            .filter((r) => r[field] === value)
            .map((r) => Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, r[c.split(".")[1]!]])));
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

vi.mock("@/lib/server/system", async () => {
  const catalog = await vi.importActual<typeof import("@/lib/server/system/catalog")>(
    "@/lib/server/system/catalog"
  );
  return { findPublicSalonIdBySlug: catalog.findPublicSalonIdBySlug };
});

import SalonShortLinkPage from "@/app/s/[slug]/page";

function open(slug: string) {
  return SalonShortLinkPage({ params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Salon A zmienił adres `stary-adres` → `salon-a`.
  db.salons = [{ id: SALON_A, slug: "salon-a" }];
  db.history = [
    { slug: "stary-adres", salonId: SALON_A, retiredAt: new Date("2026-11-01") },
    { slug: "salon-a", salonId: SALON_A, retiredAt: null },
  ];
});

describe("/s/[slug]", () => {
  it("adres bieżący → przekierowanie na stronę salonu", async () => {
    await expect(open("salon-a")).rejects.toThrow(`NEXT_REDIRECT:/salons/${SALON_A}`);
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it("dawny adres (po zmianie w panelu) → przekierowanie na ten sam salon", async () => {
    await expect(open("stary-adres")).rejects.toThrow(`NEXT_REDIRECT:/salons/${SALON_A}`);
    expect(nav.notFound).not.toHaveBeenCalled();
  });

  it("nieznany adres → 404, bez przekierowania", async () => {
    await expect(open("nie-ma-takiego")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("niepoprawny adres (słowo zastrzeżone) → 404", async () => {
    await expect(open("admin")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.redirect).not.toHaveBeenCalled();
  });
});

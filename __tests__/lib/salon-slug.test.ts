// @vitest-environment node
/**
 * Krótki adres salonu `/s/<slug>` — czyste reguły z src/lib/salon-slug.ts:
 * generowanie z nazwy (polskie znaki), walidacja, słowa zastrzeżone,
 * konflikt (sufiks -2, -3…), rozpoznanie 23505 na salons_slug_uq.
 */
import { describe, expect, it } from "vitest";
import {
  RESERVED_SALON_SLUGS,
  SALON_SLUG_MAX_LENGTH,
  isSalonSlugConflict,
  isValidSalonSlug,
  normalizeToSlug,
  pickAvailableSalonSlug,
  salonShortUrl,
  salonSlugProblem,
  salonSlugProblemMessage,
  slugFromSalonName,
  slugWithSuffix,
} from "@/lib/salon-slug";

describe("slugFromSalonName — polskie znaki i normalizacja", () => {
  it.each([
    ["Salon Ada", "salon-ada"],
    ["Zakład Fryzjerski Łucja", "zaklad-fryzjerski-lucja"],
    ["ŻÓŁĆ gęślą jaźń", "zolc-gesla-jazn"],
    ["Ąę Ćń Óś Źż", "ae-cn-os-zz"],
    ["  Beauty   Studio -- Demo!!  ", "beauty-studio-demo"],
    ["Café Élégance", "cafe-elegance"],
    ["Studio 24/7 & Spa", "studio-24-7-spa"],
    ["Beauty Studio Demo", "beauty-studio-demo"],
  ])("%s → %s", (name, slug) => {
    expect(slugFromSalonName(name)).toBe(slug);
    expect(isValidSalonSlug(slug)).toBe(true);
  });

  it("pusta albo nieczytelna nazwa → `salon`", () => {
    expect(slugFromSalonName("")).toBe("salon");
    expect(slugFromSalonName("!!! ???")).toBe("salon");
    expect(slugFromSalonName("💇‍♀️")).toBe("salon");
  });

  it("za krótka nazwa → przedrostek `salon-`", () => {
    expect(slugFromSalonName("AB")).toBe("salon-ab");
    expect(slugFromSalonName("Ó")).toBe("salon-o");
  });

  it("nazwa równa słowu zastrzeżonemu → przedrostek `salon-`", () => {
    expect(slugFromSalonName("Admin")).toBe("salon-admin");
    expect(slugFromSalonName("Dashboard")).toBe("salon-dashboard");
    expect(slugFromSalonName("API")).toBe("salon-api");
  });

  it("długa nazwa ucięta do 50 znaków, bez myślnika na końcu", () => {
    const slug = slugFromSalonName("Salon ".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(SALON_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSalonSlug(slug)).toBe(true);
  });

  it("normalizeToSlug zwraca pusty napis dla samych znaków spoza alfabetu", () => {
    expect(normalizeToSlug("---")).toBe("");
  });
});

describe("salonSlugProblem — walidacja", () => {
  it.each(["abc", "salon-ada", "a1b2c3", "x".repeat(50), "studio-24-7"])("%s poprawny", (slug) => {
    expect(salonSlugProblem(slug)).toBeNull();
  });

  it.each([
    ["ab", "length"],
    ["", "length"],
    ["x".repeat(51), "length"],
    ["Salon-Ada", "format"],
    ["salon_ada", "format"],
    ["salon ada", "format"],
    ["-salon", "format"],
    ["salon-", "format"],
    ["salon--ada", "format"],
    ["sałon", "format"],
    ["salon/ada", "format"],
  ] as const)("%s → %s", (slug, problem) => {
    expect(salonSlugProblem(slug)).toBe(problem);
  });

  it.each(["api", "admin", "dashboard", "login", "salons", "portal", "pricing"])(
    "słowo zastrzeżone %s → reserved",
    (slug) => {
      expect(salonSlugProblem(slug)).toBe("reserved");
    }
  );

  it("`s` jest zastrzeżone (i za krótkie)", () => {
    expect(RESERVED_SALON_SLUGS.has("s")).toBe(true);
    expect(isValidSalonSlug("s")).toBe(false);
  });

  it("każde słowo zastrzeżone o poprawnym formacie jest odrzucane", () => {
    for (const word of RESERVED_SALON_SLUGS) expect(isValidSalonSlug(word), word).toBe(false);
  });

  it("komunikat dla każdego problemu po polsku", () => {
    expect(salonSlugProblemMessage("length")).toContain("od 3 do 50");
    expect(salonSlugProblemMessage("format")).toContain("małe litery");
    expect(salonSlugProblemMessage("reserved")).toContain("nie można");
  });
});

describe("konflikt adresów — sufiks -2, -3…", () => {
  it("wolny adres bez sufiksu", () => {
    expect(pickAvailableSalonSlug("salon-ada", [])).toBe("salon-ada");
    expect(pickAvailableSalonSlug("salon-ada", ["salon-ada-2"])).toBe("salon-ada");
  });

  it("zajęty → -2; zajęte -2 → -3; luka w numeracji jest wypełniana", () => {
    expect(pickAvailableSalonSlug("salon-ada", ["salon-ada"])).toBe("salon-ada-2");
    expect(pickAvailableSalonSlug("salon-ada", ["salon-ada", "salon-ada-2"])).toBe("salon-ada-3");
    expect(pickAvailableSalonSlug("salon-ada", ["salon-ada", "salon-ada-3"])).toBe("salon-ada-2");
  });

  it("sufiks przy adresie o maksymalnej długości mieści się w limicie", () => {
    const base = "a".repeat(50);
    expect(slugWithSuffix(base, 2)).toBe(`${"a".repeat(48)}-2`);
    expect(slugWithSuffix(base, 10)).toHaveLength(50);
    expect(pickAvailableSalonSlug(base, [base])).toHaveLength(50);
    expect(isValidSalonSlug(pickAvailableSalonSlug(base, [base]))).toBe(true);
  });

  it("ucięcie przed sufiksem nie zostawia podwójnego myślnika", () => {
    const base = `${"a".repeat(47)}-bc`; // 50 znaków, myślnik na pozycji 48
    const slug = slugWithSuffix(base, 2);
    expect(slug).toBe(`${"a".repeat(47)}-2`);
    expect(isValidSalonSlug(slug)).toBe(true);
  });
});

describe("isSalonSlugConflict", () => {
  it("23505 na salons_slug_uq (postgres-js, node-postgres, opakowany przez Drizzle)", () => {
    expect(isSalonSlugConflict({ code: "23505", constraint_name: "salons_slug_uq" })).toBe(true);
    expect(isSalonSlugConflict({ code: "23505", constraint: "salons_slug_uq" })).toBe(true);
    expect(
      isSalonSlugConflict(
        Object.assign(new Error("wrap"), { cause: { code: "23505", constraint_name: "salons_slug_uq" } })
      )
    ).toBe(true);
  });

  it("inny indeks, inny kod albo brak błędu → false", () => {
    expect(isSalonSlugConflict({ code: "23505", constraint_name: "salons_owner_id_uq" })).toBe(false);
    expect(isSalonSlugConflict({ code: "23514", constraint_name: "salons_slug_uq" })).toBe(false);
    expect(isSalonSlugConflict(new Error("boom"))).toBe(false);
    expect(isSalonSlugConflict(null)).toBe(false);
  });
});

describe("salonShortUrl", () => {
  it("składa adres z originu (z ukośnikiem na końcu lub bez)", () => {
    expect(salonShortUrl("https://myhelper.pl", "salon-ada")).toBe("https://myhelper.pl/s/salon-ada");
    expect(salonShortUrl("https://myhelper.pl/", "salon-ada")).toBe("https://myhelper.pl/s/salon-ada");
  });
});

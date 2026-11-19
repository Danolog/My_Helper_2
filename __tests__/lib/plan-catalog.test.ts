/**
 * Test wywołuje planIncludesAI, isPlanOnSale i planOnSaleOr z podanymi danymi
 * i porównuje wynik z oczekiwanym. Sprawdza też wartości stałych PLANS_ON_SALE,
 * SOLD_PLAN_SLUG i AI_PLAN_SLUGS. Jeden przypadek przekazuje do planIncludesAI
 * zmienną zadeklarowaną z typem SalonAccess.
 */
import { describe, it, expect } from "vitest";
import {
  PLANS_ON_SALE,
  SOLD_PLAN_SLUG,
  AI_PLAN_SLUGS,
  isPlanOnSale,
  planOnSaleOr,
  planIncludesAI,
} from "@/lib/plan-catalog";
import type { SalonAccess } from "@/lib/subscription-predicates";

describe("plan-catalog", () => {
  describe("planIncludesAI", () => {
    it('planIncludesAI({ mode: "full", planSlug: "basic" }) → true', () => {
      expect(planIncludesAI({ mode: "full", planSlug: "basic" })).toBe(true);
    });

    it('planIncludesAI({ mode: "full", planSlug: "pro" }) → true', () => {
      expect(planIncludesAI({ mode: "full", planSlug: "pro" })).toBe(true);
    });

    it('planIncludesAI({ mode: "full", planSlug: "enterprise" }) → false', () => {
      expect(planIncludesAI({ mode: "full", planSlug: "enterprise" })).toBe(false);
    });

    it('planIncludesAI({ mode: "read_only", planSlug: "basic" }) → false', () => {
      expect(planIncludesAI({ mode: "read_only", planSlug: "basic" })).toBe(false);
    });

    it('planIncludesAI({ mode: "read_only", planSlug: "pro" }) → false', () => {
      expect(planIncludesAI({ mode: "read_only", planSlug: "pro" })).toBe(false);
    });

    it('planIncludesAI({ mode: "full", planSlug: null }) → false', () => {
      expect(planIncludesAI({ mode: "full", planSlug: null })).toBe(false);
    });

    it("planIncludesAI(null) → false", () => {
      expect(planIncludesAI(null)).toBe(false);
    });

    it("planIncludesAI() → false", () => {
      expect(planIncludesAI()).toBe(false);
    });

    it('planIncludesAI({ mode: "full", planSlug: "constructor" }) → false', () => {
      expect(planIncludesAI({ mode: "full", planSlug: "constructor" })).toBe(false);
    });

    it('planIncludesAI({ mode: "full", planSlug: "Basic" }) → false', () => {
      expect(planIncludesAI({ mode: "full", planSlug: "Basic" })).toBe(false);
    });

    it('planIncludesAI(SalonAccess { state: "trialing", mode: "full", planSlug: "basic", until: Date }) → true', () => {
      const access: SalonAccess = {
        state: "trialing",
        mode: "full",
        planSlug: "basic",
        until: new Date("2026-12-03T00:00:00.000Z"),
      };
      expect(planIncludesAI(access)).toBe(true);
    });
  });

  describe("isPlanOnSale", () => {
    it('isPlanOnSale("basic") → true', () => {
      expect(isPlanOnSale("basic")).toBe(true);
    });

    it('isPlanOnSale("pro") → false', () => {
      expect(isPlanOnSale("pro")).toBe(false);
    });

    it("isPlanOnSale(undefined) → false", () => {
      expect(isPlanOnSale(undefined)).toBe(false);
    });

    it("isPlanOnSale(null) → false", () => {
      expect(isPlanOnSale(null)).toBe(false);
    });

    it("isPlanOnSale(0) → false", () => {
      expect(isPlanOnSale(0)).toBe(false);
    });

    it('isPlanOnSale("constructor") → false', () => {
      expect(isPlanOnSale("constructor")).toBe(false);
    });

    it('isPlanOnSale("toString") → false', () => {
      expect(isPlanOnSale("toString")).toBe(false);
    });

    it('isPlanOnSale("Basic") → false', () => {
      expect(isPlanOnSale("Basic")).toBe(false);
    });

    it('isPlanOnSale(" basic") → false', () => {
      expect(isPlanOnSale(" basic")).toBe(false);
    });

    it('isPlanOnSale("") → false', () => {
      expect(isPlanOnSale("")).toBe(false);
    });
  });

  describe("planOnSaleOr", () => {
    it('planOnSaleOr("basic") → "basic"', () => {
      expect(planOnSaleOr("basic")).toBe("basic");
    });

    it('planOnSaleOr("pro") → "basic"', () => {
      expect(planOnSaleOr("pro")).toBe("basic");
    });

    it('planOnSaleOr(undefined) → "basic"', () => {
      expect(planOnSaleOr(undefined)).toBe("basic");
    });

    it('planOnSaleOr("constructor") → "basic"', () => {
      expect(planOnSaleOr("constructor")).toBe("basic");
    });
  });

  describe("stałe", () => {
    it('PLANS_ON_SALE → ["basic"]', () => {
      expect(PLANS_ON_SALE).toEqual(["basic"]);
    });

    it('SOLD_PLAN_SLUG → "basic"', () => {
      expect(SOLD_PLAN_SLUG).toBe("basic");
    });

    it('AI_PLAN_SLUGS → ["basic", "pro"]', () => {
      expect(AI_PLAN_SLUGS).toEqual(["basic", "pro"]);
    });
  });
});

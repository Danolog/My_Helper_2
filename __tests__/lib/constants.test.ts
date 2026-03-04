import { describe, it, expect } from "vitest";
import {
  PLANS,
  DEFAULT_VAT_RATE,
  DEFAULT_COMMISSION_RATE,
  DEFAULT_DEPOSIT_PERCENTAGE,
  TRIAL_DAYS,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
} from "@/lib/constants";

describe("constants", () => {
  describe("PLANS", () => {
    it("should define a basic plan with correct properties", () => {
      expect(PLANS.basic).toBeDefined();
      expect(PLANS.basic.slug).toBe("basic");
      expect(PLANS.basic.name).toBe("Basic");
      expect(PLANS.basic.priceMonthly).toBe(49);
      expect(PLANS.basic.priceLabel).toBe("49 PLN/mies.");
    });

    it("should define a pro plan with correct properties", () => {
      expect(PLANS.pro).toBeDefined();
      expect(PLANS.pro.slug).toBe("pro");
      expect(PLANS.pro.name).toBe("Pro");
      expect(PLANS.pro.priceMonthly).toBe(149);
      expect(PLANS.pro.priceLabel).toBe("149 PLN/mies.");
    });

    it("should have pro plan priced higher than basic plan", () => {
      expect(PLANS.pro.priceMonthly).toBeGreaterThan(PLANS.basic.priceMonthly);
    });
  });

  describe("tax and fee constants", () => {
    it("should set DEFAULT_VAT_RATE to 23%", () => {
      expect(DEFAULT_VAT_RATE).toBe(23);
    });

    it("should set DEFAULT_COMMISSION_RATE to 50%", () => {
      expect(DEFAULT_COMMISSION_RATE).toBe(50);
    });

    it("should set DEFAULT_DEPOSIT_PERCENTAGE to 30%", () => {
      expect(DEFAULT_DEPOSIT_PERCENTAGE).toBe(30);
    });
  });

  describe("trial period", () => {
    it("should set TRIAL_DAYS to 14", () => {
      expect(TRIAL_DAYS).toBe(14);
    });
  });

  describe("locale constants", () => {
    it("should set DEFAULT_CURRENCY to PLN", () => {
      expect(DEFAULT_CURRENCY).toBe("PLN");
    });

    it("should set DEFAULT_LOCALE to pl-PL", () => {
      expect(DEFAULT_LOCALE).toBe("pl-PL");
    });
  });
});

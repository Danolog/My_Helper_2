import { describe, it, expect } from "vitest";
import {
  netGrosze,
  grossGrosze,
  vatSplitFromGross,
  formatZl,
  planPriceText,
  planGrossText,
} from "@/lib/plan-price";

describe("plan-price", () => {
  describe("netGrosze", () => {
    it('netGrosze("49.00") → 4900', () => {
      expect(netGrosze("49.00")).toBe(4900);
    });

    it("netGrosze(49) → 4900", () => {
      expect(netGrosze(49)).toBe(4900);
    });

    it('netGrosze("49.5") → 4950', () => {
      expect(netGrosze("49.5")).toBe(4950);
    });

    it('netGrosze("0.01") → 1', () => {
      expect(netGrosze("0.01")).toBe(1);
    });

    it('netGrosze(" 49.00 ") → 4900', () => {
      expect(netGrosze(" 49.00 ")).toBe(4900);
    });

    it('netGrosze("49.999") rzuca wyjątek', () => {
      expect(() => netGrosze("49.999")).toThrow();
    });

    it('netGrosze("-1") rzuca wyjątek', () => {
      expect(() => netGrosze("-1")).toThrow();
    });

    it("netGrosze(-1) rzuca wyjątek", () => {
      expect(() => netGrosze(-1)).toThrow();
    });

    it("netGrosze(NaN) rzuca wyjątek", () => {
      expect(() => netGrosze(NaN)).toThrow();
    });

    it("netGrosze(Infinity) rzuca wyjątek", () => {
      expect(() => netGrosze(Infinity)).toThrow();
    });

    it('netGrosze("") rzuca wyjątek', () => {
      expect(() => netGrosze("")).toThrow();
    });

    it('netGrosze("49,00") rzuca wyjątek', () => {
      expect(() => netGrosze("49,00")).toThrow();
    });

    it('netGrosze("abc") rzuca wyjątek', () => {
      expect(() => netGrosze("abc")).toThrow();
    });

    it("netGrosze(1e21) rzuca wyjątek", () => {
      expect(() => netGrosze(1e21)).toThrow();
    });
  });

  describe("grossGrosze", () => {
    it('grossGrosze("49.00") → 6027', () => {
      expect(grossGrosze("49.00")).toBe(6027);
    });

    it('grossGrosze("149.00") → 18327', () => {
      expect(grossGrosze("149.00")).toBe(18327);
    });

    it("grossGrosze(0) → 0", () => {
      expect(grossGrosze(0)).toBe(0);
    });

    it('grossGrosze("0.01") → 1', () => {
      expect(grossGrosze("0.01")).toBe(1);
    });

    it('grossGrosze("0.50") → 62', () => {
      expect(grossGrosze("0.50")).toBe(62);
    });

    it('grossGrosze("100.00", 0) → 10000', () => {
      expect(grossGrosze("100.00", 0)).toBe(10000);
    });

    it('grossGrosze("100.00", 8) → 10800', () => {
      expect(grossGrosze("100.00", 8)).toBe(10800);
    });

    it('grossGrosze("49.00", 23.5) rzuca wyjątek', () => {
      expect(() => grossGrosze("49.00", 23.5)).toThrow();
    });

    it('grossGrosze("49.00", -1) rzuca wyjątek', () => {
      expect(() => grossGrosze("49.00", -1)).toThrow();
    });

    it('grossGrosze("49.00", 101) rzuca wyjątek', () => {
      expect(() => grossGrosze("49.00", 101)).toThrow();
    });
  });

  describe("vatSplitFromGross", () => {
    it("vatSplitFromGross(6027) → { net: 4900, vat: 1127 }", () => {
      expect(vatSplitFromGross(6027)).toEqual({ net: 4900, vat: 1127 });
    });

    it("vatSplitFromGross(18327) → { net: 14900, vat: 3427 }", () => {
      expect(vatSplitFromGross(18327)).toEqual({ net: 14900, vat: 3427 });
    });

    it("vatSplitFromGross(0) → { net: 0, vat: 0 }", () => {
      expect(vatSplitFromGross(0)).toEqual({ net: 0, vat: 0 });
    });

    it("vatSplitFromGross(1) → { net: 1, vat: 0 }", () => {
      expect(vatSplitFromGross(1)).toEqual({ net: 1, vat: 0 });
    });

    it("vatSplitFromGross(grossGrosze(n)).net → n * 100 dla każdego n od 1 do 500", () => {
      for (let n = 1; n <= 500; n++) {
        expect(vatSplitFromGross(grossGrosze(n)).net).toBe(n * 100);
      }
    });

    it("vatSplitFromGross(-1) rzuca wyjątek", () => {
      expect(() => vatSplitFromGross(-1)).toThrow();
    });

    it("vatSplitFromGross(1.5) rzuca wyjątek", () => {
      expect(() => vatSplitFromGross(1.5)).toThrow();
    });
  });

  describe("formatZl", () => {
    it('formatZl(4900) → "49 zł"', () => {
      expect(formatZl(4900)).toBe("49 zł");
    });

    it('formatZl(6027) → "60,27 zł"', () => {
      expect(formatZl(6027)).toBe("60,27 zł");
    });

    it('formatZl(5) → "0,05 zł"', () => {
      expect(formatZl(5)).toBe("0,05 zł");
    });

    it('formatZl(0) → "0 zł"', () => {
      expect(formatZl(0)).toBe("0 zł");
    });

    it('formatZl(123456) → "1234,56 zł"', () => {
      expect(formatZl(123456)).toBe("1234,56 zł");
    });

    it('formatZl(6020) → "60,20 zł"', () => {
      expect(formatZl(6020)).toBe("60,20 zł");
    });

    it("formatZl(-1) rzuca wyjątek", () => {
      expect(() => formatZl(-1)).toThrow();
    });

    it("formatZl(1.5) rzuca wyjątek", () => {
      expect(() => formatZl(1.5)).toThrow();
    });
  });

  describe("planPriceText", () => {
    it('planPriceText("49.00") → "49 zł netto + 23% VAT"', () => {
      expect(planPriceText("49.00")).toBe("49 zł netto + 23% VAT");
    });

    it('planPriceText(149) → "149 zł netto + 23% VAT"', () => {
      expect(planPriceText(149)).toBe("149 zł netto + 23% VAT");
    });

    it('planPriceText("49.00", 8) → "49 zł netto + 8% VAT"', () => {
      expect(planPriceText("49.00", 8)).toBe("49 zł netto + 8% VAT");
    });

    it('planPriceText("49.00", 23.5) rzuca wyjątek', () => {
      expect(() => planPriceText("49.00", 23.5)).toThrow();
    });
  });

  describe("planGrossText", () => {
    it('planGrossText("49.00") → "60,27 zł brutto"', () => {
      expect(planGrossText("49.00")).toBe("60,27 zł brutto");
    });

    it('planGrossText(149) → "183,27 zł brutto"', () => {
      expect(planGrossText(149)).toBe("183,27 zł brutto");
    });

    it('planGrossText("100.00", 8) → "108 zł brutto"', () => {
      expect(planGrossText("100.00", 8)).toBe("108 zł brutto");
    });
  });
});

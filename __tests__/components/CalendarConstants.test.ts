import { describe, it, expect } from "vitest";
import {
  BLOCK_TYPE_CONFIG,
  getBlockStyle,
} from "@/components/calendar/calendar-constants";

describe("calendar-constants", () => {
  describe("BLOCK_TYPE_CONFIG", () => {
    it("contains all expected block types", () => {
      expect(BLOCK_TYPE_CONFIG).toHaveProperty("vacation");
      expect(BLOCK_TYPE_CONFIG).toHaveProperty("break");
      expect(BLOCK_TYPE_CONFIG).toHaveProperty("personal");
      expect(BLOCK_TYPE_CONFIG).toHaveProperty("holiday");
      expect(BLOCK_TYPE_CONFIG).toHaveProperty("other");
    });

    it("has correct label for each block type", () => {
      expect(BLOCK_TYPE_CONFIG["vacation"]!.label).toBe("Urlop");
      expect(BLOCK_TYPE_CONFIG["break"]!.label).toBe("Przerwa");
      expect(BLOCK_TYPE_CONFIG["personal"]!.label).toBe("Osobiste");
      expect(BLOCK_TYPE_CONFIG["holiday"]!.label).toBe("Swięto");
      expect(BLOCK_TYPE_CONFIG["other"]!.label).toBe("Zablokowane");
    });

    it("has bg, border, and stripe properties for each type", () => {
      for (const key of Object.keys(BLOCK_TYPE_CONFIG)) {
        const config = BLOCK_TYPE_CONFIG[key]!;
        expect(config.bg).toBeDefined();
        expect(config.border).toBeDefined();
        expect(config.stripe).toBeDefined();
        expect(config.label).toBeDefined();
      }
    });
  });

  describe("getBlockStyle", () => {
    it("returns correct style for known block types", () => {
      const vacationStyle = getBlockStyle("vacation");
      expect(vacationStyle.label).toBe("Urlop");
      expect(vacationStyle.border).toBe("#f97316");

      const breakStyle = getBlockStyle("break");
      expect(breakStyle.label).toBe("Przerwa");
      expect(breakStyle.border).toBe("#3b82f6");
    });

    it("returns 'other' style as default for unknown block types", () => {
      const unknownStyle = getBlockStyle("unknown-type");
      const otherStyle = BLOCK_TYPE_CONFIG["other"]!;

      expect(unknownStyle.label).toBe(otherStyle.label);
      expect(unknownStyle.bg).toBe(otherStyle.bg);
      expect(unknownStyle.border).toBe(otherStyle.border);
      expect(unknownStyle.stripe).toBe(otherStyle.stripe);
    });

    it("returns 'other' style for empty string", () => {
      const emptyStyle = getBlockStyle("");
      expect(emptyStyle.label).toBe("Zablokowane");
    });
  });
});

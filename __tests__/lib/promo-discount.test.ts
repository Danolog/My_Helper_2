import { describe, it, expect } from "vitest";
import { checkPromotionApplicable, computePromoDiscount } from "@/lib/promo-discount";

const NOW = new Date("2026-06-01T12:00:00Z");

const basePromotion = {
  type: "percentage",
  value: "10.00",
  isActive: true,
  startDate: null,
  endDate: null,
  conditionsJson: {},
};

describe("computePromoDiscount", () => {
  it("procent od ceny uslugi", () => {
    expect(computePromoDiscount("100.00", { type: "percentage", value: "10.00" })).toBe(10);
  });

  it("zaokragla do groszy", () => {
    expect(computePromoDiscount("99.99", { type: "percentage", value: "15" })).toBe(15);
    expect(computePromoDiscount("33.33", { type: "percentage", value: "10" })).toBe(3.33);
  });

  it("kwota stala", () => {
    expect(computePromoDiscount("100.00", { type: "fixed", value: "25.50" })).toBe(25.5);
  });

  it("kwota stala wieksza niz cena jest obcinana do ceny", () => {
    expect(computePromoDiscount("100.00", { type: "fixed", value: "150.00" })).toBe(100);
  });

  it("procent ponad 100 jest obcinany do ceny", () => {
    expect(computePromoDiscount(80, { type: "percentage", value: 150 })).toBe(80);
  });

  it("typy inne niz fixed licza value jako procent (jak panel)", () => {
    expect(computePromoDiscount("200.00", { type: "package", value: "5" })).toBe(10);
  });

  it("zero dla wartosci ujemnej, zerowej lub niepoprawnej", () => {
    expect(computePromoDiscount("100.00", { type: "fixed", value: "-20" })).toBe(0);
    expect(computePromoDiscount("100.00", { type: "percentage", value: "0" })).toBe(0);
    expect(computePromoDiscount("100.00", { type: "percentage", value: "abc" })).toBe(0);
  });

  it("zero dla ceny zerowej lub niepoprawnej", () => {
    expect(computePromoDiscount("0", { type: "fixed", value: "10" })).toBe(0);
    expect(computePromoDiscount("abc", { type: "fixed", value: "10" })).toBe(0);
  });
});

describe("checkPromotionApplicable", () => {
  it("aktywna promocja bez warunkow => null (mozna zastosowac)", () => {
    expect(checkPromotionApplicable(basePromotion, "svc-1", NOW)).toBeNull();
  });

  it("nieaktywna", () => {
    expect(checkPromotionApplicable({ ...basePromotion, isActive: false }, "svc-1", NOW)).toBe(
      "inactive"
    );
  });

  it("jeszcze sie nie rozpoczela", () => {
    expect(
      checkPromotionApplicable({ ...basePromotion, startDate: "2026-07-01T00:00:00Z" }, "svc-1", NOW)
    ).toBe("not_started");
  });

  it("juz sie zakonczyla", () => {
    expect(
      checkPromotionApplicable({ ...basePromotion, endDate: new Date("2026-05-01T00:00:00Z") }, "svc-1", NOW)
    ).toBe("ended");
  });

  it("w zakresie dat => null", () => {
    expect(
      checkPromotionApplicable(
        { ...basePromotion, startDate: "2026-05-01T00:00:00Z", endDate: "2026-07-01T00:00:00Z" },
        "svc-1",
        NOW
      )
    ).toBeNull();
  });

  it("usluga spoza applicableServiceIds", () => {
    expect(
      checkPromotionApplicable(
        { ...basePromotion, conditionsJson: { applicableServiceIds: ["svc-2"] } },
        "svc-1",
        NOW
      )
    ).toBe("service_not_applicable");
  });

  it("usluga z listy applicableServiceIds lub pusta lista => null", () => {
    expect(
      checkPromotionApplicable(
        { ...basePromotion, conditionsJson: { applicableServiceIds: ["svc-1"] } },
        "svc-1",
        NOW
      )
    ).toBeNull();
    expect(
      checkPromotionApplicable({ ...basePromotion, conditionsJson: { applicableServiceIds: [] } }, "svc-1", NOW)
    ).toBeNull();
  });

  it("conditionsJson null => null", () => {
    expect(checkPromotionApplicable({ ...basePromotion, conditionsJson: null }, "svc-1", NOW)).toBeNull();
  });

  it("domyslnie uzywa biezacej daty", () => {
    expect(checkPromotionApplicable({ ...basePromotion, endDate: "2000-01-01T00:00:00Z" }, "svc-1")).toBe(
      "ended"
    );
  });
});

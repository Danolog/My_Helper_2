/**
 * Test wywołuje safeParse schematów subscriptionCheckoutSchema
 * i downgradeSubscriptionSchema z prawdziwą listą PLANS_ON_SALE z
 * @/lib/plan-catalog (bez atrapy) i sprawdza wynik oraz komunikat błędu.
 * Sprawdza też, że CHECKOUT_PLAN_SLUGS to ta sama tablica co PLANS_ON_SALE.
 */
import { describe, it, expect } from "vitest";
import {
  CHECKOUT_PLAN_SLUGS,
  downgradeSubscriptionSchema,
  subscriptionCheckoutSchema,
} from "@/lib/api-validation";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";

describe("schematy planów a PLANS_ON_SALE", () => {
  it('subscriptionCheckoutSchema.safeParse({ planSlug: "pro" }).success === false', () => {
    expect(subscriptionCheckoutSchema.safeParse({ planSlug: "pro" }).success).toBe(false);
  });

  it.each(PLANS_ON_SALE)(
    "subscriptionCheckoutSchema.safeParse({ planSlug: %j }).success === true",
    (slug) => {
      expect(subscriptionCheckoutSchema.safeParse({ planSlug: slug }).success).toBe(true);
    },
  );

  it("CHECKOUT_PLAN_SLUGS jest tą samą tablicą co PLANS_ON_SALE (toBe)", () => {
    expect(CHECKOUT_PLAN_SLUGS).toBe(PLANS_ON_SALE);
  });

  it('komunikat błędu dla planSlug "pro" (error.issues[0].message) zawiera każdy element PLANS_ON_SALE i nie zawiera "pro"', () => {
    const result = subscriptionCheckoutSchema.safeParse({ planSlug: "pro" });

    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    for (const slug of PLANS_ON_SALE) {
      expect(message).toContain(slug);
    }
    expect(message).not.toContain("pro");
  });

  it('downgradeSubscriptionSchema.safeParse({ targetPlanSlug: "pro" }).success === true', () => {
    expect(downgradeSubscriptionSchema.safeParse({ targetPlanSlug: "pro" }).success).toBe(true);
  });
});

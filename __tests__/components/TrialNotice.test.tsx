/**
 * Komunikat okresu próbnego w panelu subskrypcji: przycisk „Wykup subskrypcje”
 * woła onChangePlan ze slugiem z planOnSaleOr(plan.slug) (na prawdziwej liście
 * PLANS_ON_SALE), a przy statusie "active" komponent nic nie renderuje.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TrialNotice } from "@/app/dashboard/subscription/_components/trial-notice";
import type {
  PlanData,
  SubscriptionData,
} from "@/app/dashboard/subscription/_types";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";

const DAY_MS = 24 * 60 * 60 * 1000;

function trialSubscription(
  overrides: Partial<SubscriptionData> = {},
): SubscriptionData {
  const now = Date.now();
  return {
    id: "sub-row-1",
    salonId: "salon-1",
    planId: "plan-1",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    status: "trialing",
    trialEndsAt: new Date(now + 7 * DAY_MS).toISOString(),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    createdAt: new Date(now - 7 * DAY_MS).toISOString(),
    ...overrides,
  };
}

function planWithSlug(slug: string): PlanData {
  return {
    id: "plan-1",
    name: "Plan",
    slug,
    priceMonthly: "49.00",
    features: [],
    isActive: true,
  };
}

function renderNotice(subscription: SubscriptionData, plan: PlanData) {
  const onChangePlan = vi.fn().mockResolvedValue(undefined);
  render(
    <TrialNotice
      subscription={subscription}
      plan={plan}
      changePlanLoading={false}
      onChangePlan={onChangePlan}
    />,
  );
  return onChangePlan;
}

describe("TrialNotice", () => {
  it('okres próbny na planie "pro": klik „Wykup subskrypcje” woła onChangePlan raz z "basic"', () => {
    const onChangePlan = renderNotice(trialSubscription(), planWithSlug("pro"));

    fireEvent.click(screen.getByRole("button", { name: /Wykup subskrypcje/ }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it('okres próbny na planie "basic": klik „Wykup subskrypcje” woła onChangePlan raz z "basic"', () => {
    const onChangePlan = renderNotice(trialSubscription(), planWithSlug("basic"));

    fireEvent.click(screen.getByRole("button", { name: /Wykup subskrypcje/ }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it.each(PLANS_ON_SALE)(
    'okres próbny na planie "%s" z PLANS_ON_SALE: klik „Wykup subskrypcje” woła onChangePlan raz z tym samym slugiem',
    (slug) => {
      const onChangePlan = renderNotice(trialSubscription(), planWithSlug(slug));

      fireEvent.click(screen.getByRole("button", { name: /Wykup subskrypcje/ }));

      expect(onChangePlan).toHaveBeenCalledTimes(1);
      expect(onChangePlan).toHaveBeenCalledWith(slug);
    },
  );

  it('status "active" z datą końca okresu próbnego w przyszłości: komponent nic nie renderuje', () => {
    const { container } = render(
      <TrialNotice
        subscription={trialSubscription({ status: "active" })}
        plan={planWithSlug("pro")}
        changePlanLoading={false}
        onChangePlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

/**
 * Komunikat okresu próbnego w panelu subskrypcji: przycisk „Wykup subskrypcje”
 * woła onChangePlan ze slugiem z planOnSaleOr(plan.slug) (na prawdziwej liście
 * PLANS_ON_SALE), tekst ceny po okresie próbnym pochodzi z wiersza allPlans
 * o tym samym slugu, a przy statusie "active" komponent nic nie renderuje.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TrialNotice } from "@/app/dashboard/subscription/_components/trial-notice";
import type {
  AllPlansMap,
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

function planWithSlug(slug: string, price = "49.00"): PlanData {
  return {
    id: "plan-1",
    name: "Plan",
    slug,
    priceMonthly: price,
    features: [],
    isActive: true,
  };
}

function renderNotice(
  subscription: SubscriptionData,
  plan: PlanData,
  allPlans: AllPlansMap = { basic: planWithSlug("basic") },
) {
  const onChangePlan = vi.fn().mockResolvedValue(undefined);
  render(
    <TrialNotice
      subscription={subscription}
      plan={plan}
      allPlans={allPlans}
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
        allPlans={{ basic: planWithSlug("basic") }}
        changePlanLoading={false}
        onChangePlan={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it('okres próbny na planie "pro" 149.00, wiersz "basic" na liście 49.00: tekst „49 zł netto + 23% VAT / miesiac po okresie probnym”, brak tekstu z 149, klik woła onChangePlan z "basic"', () => {
    const onChangePlan = renderNotice(
      trialSubscription(),
      planWithSlug("pro", "149.00"),
      { basic: planWithSlug("basic", "49.00") },
    );

    expect(
      screen.getByText("49 zł netto + 23% VAT / miesiac po okresie probnym"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/149/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Wykup subskrypcje/ }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it('okres próbny na planie "basic" 49.00, wiersz "basic" na liście 59.00: tekst „59 zł netto + 23% VAT / miesiac po okresie probnym”', () => {
    renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
      basic: planWithSlug("basic", "59.00"),
    });

    expect(
      screen.getByText("59 zł netto + 23% VAT / miesiac po okresie probnym"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/49 zł/)).toBeNull();
  });

  it('pusta lista planów: brak tekstu „po okresie probnym”, przycisk „Wykup subskrypcje” jest i klik woła onChangePlan z "basic"', () => {
    const onChangePlan = renderNotice(
      trialSubscription(),
      planWithSlug("pro", "149.00"),
      {},
    );

    expect(screen.queryByText(/po okresie probnym/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Wykup subskrypcje/ }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it('wiersz "basic" na liście z ceną "abc": render bez wyjątku, brak tekstu „po okresie probnym”, przycisk „Wykup subskrypcje” jest', () => {
    expect(() =>
      renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
        basic: planWithSlug("basic", "abc"),
      }),
    ).not.toThrow();

    expect(screen.queryByText(/po okresie probnym/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Wykup subskrypcje/ }),
    ).toBeInTheDocument();
  });

  it('2 dni do końca okresu próbnego na planie "pro" 149.00, wiersz "basic" na liście 49.00: komunikat „konczy sie za 2 dni” i tekst „49 zł netto + 23% VAT / miesiac po okresie probnym”', () => {
    renderNotice(
      trialSubscription({
        trialEndsAt: new Date(Date.now() + 2 * DAY_MS - 60 * 1000).toISOString(),
      }),
      planWithSlug("pro", "149.00"),
      { basic: planWithSlug("basic", "49.00") },
    );

    expect(
      screen.getByText("Okres probny konczy sie za 2 dni!"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("49 zł netto + 23% VAT / miesiac po okresie probnym"),
    ).toBeInTheDocument();
  });

  it('okres próbny na planie "basic" 49.00, wiersz "basic" na liście 49.00: żaden tekst komponentu nie zawiera „PLN”', () => {
    renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
      basic: planWithSlug("basic", "49.00"),
    });

    expect(screen.queryByText(/PLN/)).toBeNull();
  });
});

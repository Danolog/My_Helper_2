/**
 * Komunikat okresu próbnego w panelu subskrypcji.
 *
 * Zakup otwarty (`isPlanPurchaseOpen()` = true, atrapa modułu features):
 * przycisk „Wykup subskrypcję” woła onChangePlan ze slugiem
 * z planOnSaleOr(plan.slug) (na prawdziwej liście PLANS_ON_SALE), tekst ceny
 * po okresie próbnym pochodzi z wiersza allPlans o tym samym slugu.
 *
 * Zakup zamknięty (wartość z prawdziwego modułu, false): brak przycisku
 * i ceny, w ich miejscu zdanie z adresem kontaktowym; w ostatnich 3 dniach
 * zdanie o trybie tylko do odczytu bez wezwania do zakupu.
 *
 * Przy statusie "active" komponent nic nie renderuje.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PURCHASE_CLOSED_CONTACT_TEXT,
  TrialNotice,
} from "@/app/dashboard/subscription/_components/trial-notice";
import type {
  AllPlansMap,
  PlanData,
  SubscriptionData,
} from "@/app/dashboard/subscription/_types";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";

const flags = vi.hoisted(() => ({ purchaseOpen: false, real: false }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  flags.real = actual.isPlanPurchaseOpen();
  return {
    ...actual,
    isPlanPurchaseOpen: () => flags.purchaseOpen,
  };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const BUY_BUTTON = /Wykup subskrypcję/;
const READ_ONLY_TEXT =
  "Po zakończeniu okresu próbnego panel przejdzie w tryb tylko do odczytu.";

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

function nearEndSubscription(): SubscriptionData {
  return trialSubscription({
    trialEndsAt: new Date(Date.now() + 2 * DAY_MS - 60 * 1000).toISOString(),
  });
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

describe("TrialNotice — zakup zamknięty (wartość z modułu)", () => {
  beforeEach(() => {
    flags.purchaseOpen = flags.real;
  });

  it("prawdziwy isPlanPurchaseOpen() zwraca false", () => {
    expect(flags.real).toBe(false);
  });

  it("brak przycisku „Wykup subskrypcję” i ceny po okresie próbnym, jest zdanie z adresem kontaktowym", () => {
    renderNotice(trialSubscription(), planWithSlug("basic"));

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/po okresie próbnym/)).toBeNull();
    expect(screen.getByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeInTheDocument();
    expect(PURCHASE_CLOSED_CONTACT_TEXT).toContain("kontakt@nordsignal.cc");
  });

  it("ponad 3 dni do końca: zdanie z nazwą planu i datą końca, bez liczby dni okresu próbnego", () => {
    renderNotice(trialSubscription(), planWithSlug("basic"));

    expect(
      screen.getByText(/^Korzystasz z pełnych funkcji planu Plan w okresie próbnym\. Okres próbny kończy się /),
    ).toBeInTheDocument();
    expect(screen.queryByText(/14-dniowego/)).toBeNull();
  });

  it("2 dni do końca: zdanie o trybie tylko do odczytu bez wezwania do zakupu", () => {
    renderNotice(nearEndSubscription(), planWithSlug("basic"));

    expect(screen.getByText("Okres probny konczy sie za 2 dni!")).toBeInTheDocument();
    expect(screen.getByText(READ_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/wykup subskrypcję/i)).toBeNull();
    expect(screen.getByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeInTheDocument();
  });

  it("pusta lista planów: render bez wyjątku, zdanie kontaktowe jest", () => {
    expect(() =>
      renderNotice(trialSubscription(), planWithSlug("pro", "149.00"), {}),
    ).not.toThrow();
    expect(screen.getByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeInTheDocument();
  });
});

describe("TrialNotice — zakup otwarty (atrapa)", () => {
  beforeEach(() => {
    flags.purchaseOpen = true;
  });

  it('okres próbny na planie "pro": klik „Wykup subskrypcję” woła onChangePlan raz z "basic"', () => {
    const onChangePlan = renderNotice(trialSubscription(), planWithSlug("pro"));

    fireEvent.click(screen.getByRole("button", { name: BUY_BUTTON }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
    expect(screen.queryByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeNull();
  });

  it('okres próbny na planie "basic": klik „Wykup subskrypcję” woła onChangePlan raz z "basic"', () => {
    const onChangePlan = renderNotice(trialSubscription(), planWithSlug("basic"));

    fireEvent.click(screen.getByRole("button", { name: BUY_BUTTON }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it.each(PLANS_ON_SALE)(
    'okres próbny na planie "%s" z PLANS_ON_SALE: klik „Wykup subskrypcję” woła onChangePlan raz z tym samym slugiem',
    (slug) => {
      const onChangePlan = renderNotice(trialSubscription(), planWithSlug(slug));

      fireEvent.click(screen.getByRole("button", { name: BUY_BUTTON }));

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

  it('okres próbny na planie "pro" 149.00, wiersz "basic" na liście 49.00: tekst „49 zł netto + 23% VAT / miesiąc po okresie próbnym”, brak tekstu z 149, klik woła onChangePlan z "basic"', () => {
    const onChangePlan = renderNotice(
      trialSubscription(),
      planWithSlug("pro", "149.00"),
      { basic: planWithSlug("basic", "49.00") },
    );

    expect(
      screen.getByText("49 zł netto + 23% VAT / miesiąc po okresie próbnym"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/149/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: BUY_BUTTON }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it('okres próbny na planie "basic" 49.00, wiersz "basic" na liście 59.00: tekst „59 zł netto + 23% VAT / miesiąc po okresie próbnym”', () => {
    renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
      basic: planWithSlug("basic", "59.00"),
    });

    expect(
      screen.getByText("59 zł netto + 23% VAT / miesiąc po okresie próbnym"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/49 zł/)).toBeNull();
  });

  it('pusta lista planów: brak tekstu „po okresie próbnym”, przycisk „Wykup subskrypcję” jest i klik woła onChangePlan z "basic"', () => {
    const onChangePlan = renderNotice(
      trialSubscription(),
      planWithSlug("pro", "149.00"),
      {},
    );

    expect(screen.queryByText(/po okresie próbnym/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: BUY_BUTTON }));

    expect(onChangePlan).toHaveBeenCalledTimes(1);
    expect(onChangePlan).toHaveBeenCalledWith("basic");
  });

  it('wiersz "basic" na liście z ceną "abc": render bez wyjątku, brak tekstu „po okresie próbnym”, przycisk „Wykup subskrypcję” jest', () => {
    expect(() =>
      renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
        basic: planWithSlug("basic", "abc"),
      }),
    ).not.toThrow();

    expect(screen.queryByText(/po okresie próbnym/)).toBeNull();
    expect(
      screen.getByRole("button", { name: BUY_BUTTON }),
    ).toBeInTheDocument();
  });

  it('2 dni do końca okresu próbnego na planie "pro" 149.00, wiersz "basic" na liście 49.00: komunikat „konczy sie za 2 dni”, wezwanie do zakupu i tekst ceny', () => {
    renderNotice(
      nearEndSubscription(),
      planWithSlug("pro", "149.00"),
      { basic: planWithSlug("basic", "49.00") },
    );

    expect(
      screen.getByText("Okres probny konczy sie za 2 dni!"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${READ_ONLY_TEXT} Aby zachować pełny dostęp, wykup subskrypcję.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText("49 zł netto + 23% VAT / miesiąc po okresie próbnym"),
    ).toBeInTheDocument();
  });

  it('okres próbny na planie "basic" 49.00, wiersz "basic" na liście 49.00: żaden tekst komponentu nie zawiera „PLN”', () => {
    renderNotice(trialSubscription(), planWithSlug("basic", "49.00"), {
      basic: planWithSlug("basic", "49.00"),
    });

    expect(screen.queryByText(/PLN/)).toBeNull();
  });
});

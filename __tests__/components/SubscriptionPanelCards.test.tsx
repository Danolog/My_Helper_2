/**
 * Karta ostrzeżenia o wygaśnięciu i karta automatycznego odnowienia
 * w panelu subskrypcji: obie karty bez elementów o roli button; karta
 * ostrzeżenia z banerem bliskiego wygaśnięcia i kwotą odnowienia, bez tekstu
 * „Ostatnie ostrzezenia” i bez treści wpisu z `recentWarnings`.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ExpirationWarningCard } from "@/app/dashboard/subscription/_components/expiration-warning-card";
import { RenewalCard } from "@/app/dashboard/subscription/_components/renewal-card";
import type {
  ExpirationData,
  PlanData,
  SubscriptionData,
} from "@/app/dashboard/subscription/_types";

const SUBSCRIPTION: SubscriptionData = {
  id: "sub-row-1",
  salonId: "salon-1",
  planId: "plan-pro",
  stripeSubscriptionId: "sub_test_1",
  stripeCustomerId: "cus_1",
  status: "active",
  trialEndsAt: null,
  currentPeriodStart: "2026-11-19T12:00:00.000Z",
  currentPeriodEnd: "2026-11-22T12:00:00.000Z",
  canceledAt: null,
  scheduledPlanId: null,
  scheduledChangeAt: null,
  createdAt: "2026-10-19T12:00:00.000Z",
};

const PLAN: PlanData = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  features: ["Asystent AI"],
  isActive: true,
};

const WARNING_MESSAGE = "Przypomnienie o odnowieniu subskrypcji.";

function expirationData(overrides: Partial<ExpirationData>): ExpirationData {
  return {
    daysRemaining: 3,
    warningThreshold: 7,
    isNearExpiry: true,
    renewalAmount: "149",
    recentWarnings: [
      {
        id: "warning-1",
        type: "email",
        message: WARNING_MESSAGE,
        status: "sent",
        sentAt: "2026-11-19T12:00:00.000Z",
        createdAt: "2026-11-19T12:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

const REMOVED_TEXTS = [
  /Tryb deweloperski/,
  /Symuluj/,
  /Wyslij ostrzezenie/,
  /Odnow teraz/,
  /Sprawdz metode platnosci/,
];

function expectNoButtonsAndNoRemovedTexts() {
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  for (const text of REMOVED_TEXTS) {
    expect(screen.queryByText(text)).toBeNull();
  }
}

describe("karta ostrzeżenia o wygaśnięciu", () => {
  it("isNearExpiry: true — brak przycisków i tekstów „Tryb deweloperski”, „Symuluj”, „Wyslij ostrzezenie”, „Odnow teraz”, „Sprawdz metode platnosci”", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({})}
      />,
    );

    expectNoButtonsAndNoRemovedTexts();
  });

  it("isNearExpiry: true — baner z tekstem „Subskrypcja wygasa za 3 dni!” i kwotą odnowienia „149.00 PLN”", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({})}
      />,
    );

    const bannerText = screen.getByText("Subskrypcja wygasa za 3 dni!");
    expect(within(bannerText.parentElement!).getByText("149.00 PLN")).toBeInTheDocument();
  });

  it("isNearExpiry: false — brak przycisków i tekstów „Tryb deweloperski”, „Symuluj”, „Wyslij ostrzezenie”, „Odnow teraz”, „Sprawdz metode platnosci”", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({ isNearExpiry: false, daysRemaining: 20 })}
      />,
    );

    expectNoButtonsAndNoRemovedTexts();
  });

  it.each([
    { isNearExpiry: true, daysRemaining: 3 },
    { isNearExpiry: false, daysRemaining: 20 },
  ])(
    "isNearExpiry: $isNearExpiry, recentWarnings z jednym wpisem — brak tekstu „Ostatnie ostrzezenia” i treści wpisu",
    (overrides) => {
      render(
        <ExpirationWarningCard
          subscription={SUBSCRIPTION}
          expirationData={expirationData(overrides)}
        />,
      );

      expect(screen.queryByText("Ostatnie ostrzezenia")).toBeNull();
      expect(screen.queryByText(WARNING_MESSAGE)).toBeNull();
    },
  );
});

describe("karta automatycznego odnowienia", () => {
  it("brak przycisków i tekstów „Tryb deweloperski”, „Symuluj”, „Wyslij ostrzezenie”, „Odnow teraz”, „Sprawdz metode platnosci”", () => {
    render(
      <RenewalCard subscription={SUBSCRIPTION} plan={PLAN} scheduledPlan={null} />,
    );

    expectNoButtonsAndNoRemovedTexts();
  });
});

/**
 * Karta ostrzeżenia o wygaśnięciu i karta automatycznego odnowienia
 * w panelu subskrypcji: obie karty bez elementów o roli button; karta
 * ostrzeżenia z banerem bliskiego wygaśnięcia i kwotą odnowienia.
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

function expirationData(overrides: Partial<ExpirationData>): ExpirationData {
  return {
    daysRemaining: 3,
    warningThreshold: 7,
    isNearExpiry: true,
    renewalAmount: "149",
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

  it("isNearExpiry: true — baner z tekstem „Subskrypcja wygasa za 3 dni!” i kwotą odnowienia brutto „183,27 zł brutto”", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({})}
      />,
    );

    const bannerText = screen.getByText("Subskrypcja wygasa za 3 dni!");
    expect(within(bannerText.parentElement!).getByText("183,27 zł brutto")).toBeInTheDocument();
  });

  it("wiersz „Kwota odnowienia”: brutto z netto w nawiasie, bez „PLN”", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({ renewalAmount: "49.00" })}
      />,
    );

    expect(
      screen.getByText("60,27 zł brutto (49 zł netto + 23% VAT)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PLN/)).toBeNull();
  });

  it("brak kwoty odnowienia: „-” w obu miejscach, render bez wyjątku", () => {
    render(
      <ExpirationWarningCard
        subscription={SUBSCRIPTION}
        expirationData={expirationData({ renewalAmount: null })}
      />,
    );

    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/zł/)).toBeNull();
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
});

describe("karta automatycznego odnowienia", () => {
  it("brak przycisków i tekstów „Tryb deweloperski”, „Symuluj”, „Wyslij ostrzezenie”, „Odnow teraz”, „Sprawdz metode platnosci”", () => {
    render(
      <RenewalCard subscription={SUBSCRIPTION} plan={PLAN} scheduledPlan={null} />,
    );

    expectNoButtonsAndNoRemovedTexts();
  });

  it("kwota odnowienia brutto z netto w nawiasie i zdanie o opłacie brutto, bez „PLN”", () => {
    render(
      <RenewalCard
        subscription={SUBSCRIPTION}
        plan={{ ...PLAN, priceMonthly: "49.00" }}
        scheduledPlan={null}
      />,
    );

    expect(
      screen.getByText("60,27 zł brutto (49 zł netto + 23% VAT)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Opłata 60,27 zł brutto zostanie pobrana automatycznie z\s+Twojej metody płatności\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PLN/)).toBeNull();
  });
});

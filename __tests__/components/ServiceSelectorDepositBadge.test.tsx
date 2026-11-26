/**
 * Lista usług w portalu rezerwacji: plakietka „Zadatek X%” tylko przy
 * włączonym zadatku (isDepositEnabled). Usługa zapisana z flagą zadatku
 * nie może pokazywać plakietki, gdy ścieżka zadatku jest wyłączona.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceSelector } from "@/components/booking/service-selector";
import type { ServiceItem } from "@/components/booking/types";

const flags = vi.hoisted(() => ({ deposit: false }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isDepositEnabled: () => flags.deposit,
}));

const SERVICE: ServiceItem = {
  id: "service-1",
  name: "Koloryzacja",
  basePrice: "100.00",
  baseDuration: 60,
  description: null,
  categoryId: null,
  categoryName: null,
  depositRequired: true,
  depositPercentage: 30,
  variants: [],
};

function renderSelector(service: ServiceItem = SERVICE) {
  return render(
    <ServiceSelector
      services={[service]}
      categories={[]}
      selectedServiceId=""
      expandedServices={new Set()}
      onServiceSelect={() => {}}
      onToggleExpanded={() => {}}
    />,
  );
}

function optionText(): string {
  return screen.getByTestId("booking-service-option-service-1").textContent ?? "";
}

describe("ServiceSelector — plakietka zadatku", () => {
  beforeEach(() => {
    flags.deposit = false;
  });

  it("zadatek wyłączony: usługa z flagą zadatku bez plakietki", () => {
    renderSelector();
    expect(optionText()).toContain("Koloryzacja");
    expect(optionText()).not.toMatch(/Zadatek/);
  });

  it("zadatek włączony: plakietka z procentem usługi", () => {
    flags.deposit = true;
    renderSelector();
    expect(screen.getByText("Zadatek 30%")).toBeTruthy();
  });

  it("zadatek włączony, usługa bez zadatku: bez plakietki", () => {
    flags.deposit = true;
    renderSelector({ ...SERVICE, depositRequired: false });
    expect(optionText()).not.toMatch(/Zadatek/);
  });
});

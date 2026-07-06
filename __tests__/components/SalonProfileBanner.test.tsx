import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SalonProfileBanner } from "@/components/dashboard/salon-profile-banner";

// UAT B-7: swiezy salon bez adresu i telefonu jest niewidoczny w portalu
// klienta (/api/salons filtruje po tych polach), a wlasciciel nie dostaje
// zadnej wskazowki. Baner ma o tym informowac i linkowac do ustawien.

describe("SalonProfileBanner", () => {
  it("warns when the salon has no address and no phone", () => {
    render(<SalonProfileBanner salon={{ address: null, phone: null }} />);

    expect(screen.getByTestId("salon-profile-banner")).toBeInTheDocument();
    expect(
      screen.getByText(/niewidoczny dla klientów/i),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /uzupełnij dane salonu/i });
    expect(link).toHaveAttribute("href", "/dashboard/settings/salon");
  });

  it("warns when only one of the fields is missing", () => {
    render(
      <SalonProfileBanner salon={{ address: "ul. Testowa 5", phone: null }} />,
    );
    expect(screen.getByTestId("salon-profile-banner")).toBeInTheDocument();
  });

  it("renders nothing when address and phone are set", () => {
    render(
      <SalonProfileBanner
        salon={{ address: "ul. Testowa 5", phone: "+48 600 700 800" }}
      />,
    );
    expect(screen.queryByTestId("salon-profile-banner")).toBeNull();
  });

  it("renders nothing when salon is not loaded yet", () => {
    render(<SalonProfileBanner salon={null} />);
    expect(screen.queryByTestId("salon-profile-banner")).toBeNull();
  });
});

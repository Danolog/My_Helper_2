/**
 * BookingSummary — podsumowanie rezerwacji przy zadatku BLIK na telefon salonu.
 *
 * Przy ścieżce BLIK podsumowanie nie oferuje płatności online i nie mówi
 * o przetwarzaniu płatności; przy ścieżce online wszystko jak dotąd.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingSummary } from "@/components/booking/booking-summary";
import type { ServiceItem } from "@/components/booking/types";

const flags = vi.hoisted(() => ({ blik: false }));

vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isBlikDepositFlow: () => flags.blik,
}));

afterEach(() => {
  cleanup();
  flags.blik = false;
});

const SERVICE: ServiceItem = {
  id: "svc-1",
  name: "Strzyzenie",
  basePrice: "100.00",
  baseDuration: 60,
  description: null,
  categoryId: null,
  categoryName: null,
  depositRequired: true,
  depositPercentage: 30,
  variants: [],
};

type Props = Parameters<typeof BookingSummary>[0];

interface Over {
  depositRequired?: boolean;
  isProcessingPayment?: boolean;
  onBook?: () => void;
}

function props({ depositRequired = true, isProcessingPayment = false, onBook = () => {} }: Over = {}): Props {
  return {
    canShow: true,
    hasVariants: false,
    stepNumber: 4,
    salon: { name: "Salon Testowy" },
    selectedService: SERVICE,
    selectedVariant: null,
    assignedEmployees: [],
    selectedEmployeeId: "",
    selectedDate: "2026-11-25",
    selectedTimeSlot: "10:00",
    effectiveDuration: 60,
    isLoggedIn: true,
    isBooking: false,
    isProcessingPayment,
    promotion: {
      activePromoType: "none",
      bestDiscountAmount: 0,
      baseEffectivePrice: 100,
      effectivePrice: 100,
      happyHoursPromo: null,
      firstVisitPromo: null,
    },
    deposit: {
      depositRequired,
      depositAmount: depositRequired ? 30 : 0,
      depositPercentage: 30,
    },
    guest: {
      guestName: "",
      guestPhone: "",
      guestEmail: "",
      onGuestNameChange: () => {},
      onGuestPhoneChange: () => {},
      onGuestEmailChange: () => {},
    },
    payment: {
      selectedPaymentMethod: "stripe",
      blikPhoneNumber: "",
      blikPhoneError: "",
      onPaymentMethodChange: () => {},
      onBlikPhoneChange: () => {},
      onBlikPhoneErrorClear: () => {},
    },
    onBackToDateTime: () => {},
    onBook,
  };
}

function buttonText(): string {
  return (screen.getByTestId("book-appointment-btn").textContent ?? "").trim();
}

describe("sekcja zadatku", () => {
  it("flaga false: platnosc online jak dotad, brak informacji BLIK", () => {
    const { container } = render(<BookingSummary {...props()} />);
    expect(screen.queryByTestId("payment-method-stripe")).not.toBeNull();
    expect(container.textContent).toContain("Platnosc online");
    expect(buttonText()).toBe("Zaplac zadatek 30 PLN i zarezerwuj");
    expect(screen.queryByTestId("blik-deposit-notice")).toBeNull();
  });

  it("flaga true: bez platnosci online, informacja BLIK dosłownie, przycisk BLIK", () => {
    flags.blik = true;
    const { container } = render(<BookingSummary {...props()} />);
    expect(screen.queryByTestId("payment-method-stripe")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Platnosc online");
    expect(text).not.toContain("Karta, BLIK, Przelewy24");

    const paragraphs = Array.from(
      screen.getByTestId("blik-deposit-notice").querySelectorAll("p")
    ).map((p) => p.textContent);
    expect(paragraphs).toEqual([
      "Zadatek wplacisz BLIK-iem na telefon salonu. Numer, odbiorce i tytul przelewu pokazemy po rezerwacji.",
      "Zadatek rozliczany poza MyHelper — zwrot ustala salon.",
    ]);
    expect(buttonText()).toBe("Zarezerwuj — zadatek 30 PLN BLIK-iem");
  });

  it.each([false, true])("flaga %s: identyfikatory sekcji, kwoty i przycisku zostaja", (blik) => {
    flags.blik = blik;
    render(<BookingSummary {...props()} />);
    expect(screen.queryByTestId("deposit-info-section")).not.toBeNull();
    expect(screen.getByTestId("deposit-amount-display").textContent?.trim()).toBe("30 PLN");
    expect(screen.queryByTestId("book-appointment-btn")).not.toBeNull();
  });
});

describe("przycisk w toku", () => {
  it("flaga true: Rezerwowanie..., wylaczony, bez przetwarzania platnosci", () => {
    flags.blik = true;
    render(<BookingSummary {...props({ isProcessingPayment: true })} />);
    const button = screen.getByTestId("book-appointment-btn") as HTMLButtonElement;
    expect(buttonText()).toBe("Rezerwowanie...");
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toContain("Przetwarzanie platnosci...");
  });

  it("flaga false: Przetwarzanie platnosci... jak dotad", () => {
    render(<BookingSummary {...props({ isProcessingPayment: true })} />);
    expect(buttonText()).toBe("Przetwarzanie platnosci...");
  });
});

describe("bez zadatku i klik", () => {
  it("flaga true, bez zadatku: brak sekcji zadatku i informacji BLIK, Potwierdz rezerwacje", () => {
    flags.blik = true;
    render(<BookingSummary {...props({ depositRequired: false })} />);
    expect(screen.queryByTestId("deposit-info-section")).toBeNull();
    expect(screen.queryByTestId("blik-deposit-notice")).toBeNull();
    expect(buttonText()).toBe("Potwierdz rezerwacje");
  });

  it("flaga true: klik przycisku wola onBook", () => {
    flags.blik = true;
    const onBook = vi.fn();
    render(<BookingSummary {...props({ onBook })} />);
    fireEvent.click(screen.getByTestId("book-appointment-btn"));
    expect(onBook).toHaveBeenCalledTimes(1);
  });
});

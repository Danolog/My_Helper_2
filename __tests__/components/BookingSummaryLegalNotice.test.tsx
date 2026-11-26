/**
 * BookingSummary — informacja o regulaminie i polityce prywatności przy rezerwacji gościa.
 *
 * Stan publikacji przychodzi do prawdziwej funkcji `bookingLegalNotice` jako parametr.
 * Wartość domyślną komponentu ustawia test (atrapa `bookingLegalNotice` przekazuje
 * jawną flagę do prawdziwej funkcji), więc wynik nie zależy od wartości flagi
 * w module. Przy wyłączonej fladze nie ma zdania ani odnośników do stron, które
 * odpowiadają 404. Zalogowany klient nie widzi informacji: akceptował regulamin
 * przy zakładaniu konta.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingSummary } from "@/components/booking/booking-summary";
import type { ServiceItem } from "@/components/booking/types";
import {
  LEGAL_DOCUMENTS,
  bookingLegalNotice,
  type LegalDocuments,
} from "@/lib/legal/documents";

const legal = vi.hoisted(() => ({ published: false }));

vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/documents")>();
  const versioned: LegalDocuments = {
    ...actual.LEGAL_DOCUMENTS,
    privacy: { ...actual.LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
    terms: { ...actual.LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
    dpa: { ...actual.LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
  };
  return {
    ...actual,
    bookingLegalNotice: (
      published: boolean = legal.published,
      documents: LegalDocuments = versioned,
    ) => actual.bookingLegalNotice(published, documents),
  };
});

beforeEach(() => {
  legal.published = false;
});

afterEach(cleanup);

const PUBLISHED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
};

const SENTENCE = "Rezerwując, akceptujesz regulamin";

const SERVICE: ServiceItem = {
  id: "svc-1",
  name: "Strzyzenie",
  basePrice: "100.00",
  baseDuration: 60,
  description: null,
  categoryId: null,
  categoryName: null,
  depositRequired: false,
  depositPercentage: 0,
  variants: [],
};

type Props = Parameters<typeof BookingSummary>[0];

function props(isLoggedIn: boolean, legalNotice?: Props["legalNotice"]): Props {
  const base: Props = {
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
    isLoggedIn,
    isBooking: false,
    isProcessingPayment: false,
    promotion: {
      activePromoType: "none",
      bestDiscountAmount: 0,
      baseEffectivePrice: 100,
      effectivePrice: 100,
      happyHoursPromo: null,
      firstVisitPromo: null,
    },
    deposit: { depositRequired: false, depositAmount: 0, depositPercentage: 0 },
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
    onBook: () => {},
  };
  // Brak klucza = wartość domyślna komponentu (stan ustawiony w teście).
  return legalNotice === undefined ? base : { ...base, legalNotice };
}

describe("flaga wyłączona", () => {
  it("wartość domyślna komponentu: gość nie widzi zdania ani odnośników do /terms i /privacy", () => {
    const { container } = render(<BookingSummary {...props(false)} />);

    expect(screen.queryByTestId("booking-legal-notice")).toBeNull();
    expect(container.textContent).not.toContain(SENTENCE);
    expect(container.querySelector('a[href="/terms"]')).toBeNull();
    expect(container.querySelector('a[href="/privacy"]')).toBeNull();
  });

  it("stan przekazany wprost (flaga false) daje to samo", () => {
    render(<BookingSummary {...props(false, bookingLegalNotice(false, PUBLISHED))} />);
    expect(screen.queryByTestId("booking-legal-notice")).toBeNull();
  });
});

describe("flaga włączona", () => {
  it("gość: zdanie „Rezerwując, akceptujesz regulamin” i odnośniki do /terms i /privacy", () => {
    render(<BookingSummary {...props(false, bookingLegalNotice(true, PUBLISHED))} />);

    const notice = screen.getByTestId("booking-legal-notice");
    expect(notice.textContent).toContain(SENTENCE);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "polityka prywatności" })).toHaveAttribute("href", "/privacy");
  });

  it("wartość domyślna komponentu: gość widzi zdanie z odnośnikami do /terms i /privacy", () => {
    legal.published = true;
    render(<BookingSummary {...props(false)} />);

    expect(screen.getByTestId("booking-legal-notice").textContent).toContain(SENTENCE);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "polityka prywatności" })).toHaveAttribute("href", "/privacy");
  });

  it("bez pola wyboru: przycisk rezerwacji aktywny bez dodatkowej akcji", () => {
    const { container } = render(<BookingSummary {...props(false, bookingLegalNotice(true, PUBLISHED))} />);

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.getByTestId("book-appointment-btn")).toBeEnabled();
  });

  it("odnośniki otwierają się w nowej karcie (formularz rezerwacji zostaje)", () => {
    render(<BookingSummary {...props(false, bookingLegalNotice(true, PUBLISHED))} />);
    for (const name of ["regulamin", "polityka prywatności"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("zalogowany klient: bez informacji (nie ma formularza gościa)", () => {
    render(<BookingSummary {...props(true, bookingLegalNotice(true, PUBLISHED))} />);
    expect(screen.queryByTestId("booking-legal-notice")).toBeNull();
  });
});

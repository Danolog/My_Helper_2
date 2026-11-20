/**
 * BookingConfirmation — ekran po rezerwacji przy zadatku BLIK na telefon salonu.
 *
 * Gałąź BLIK nie może twierdzić, że zadatek jest opłacony; dane przelewu
 * pochodzą wyłącznie z odpowiedzi serwera; gałąź online zostaje bez zmian.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingConfirmation } from "@/components/booking/booking-confirmation";
import type { ServiceItem } from "@/components/booking/types";
import { TEST_PHONE, TEST_PHONE_NUMBERS } from "@/lib/test-phone";

const flags = vi.hoisted(() => ({ blik: false }));

vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isBlikDepositFlow: () => flags.blik,
}));

afterEach(() => {
  cleanup();
  flags.blik = false;
  vi.restoreAllMocks();
});

// Salon phone from the test-number list; digits used for leak checks.
const SALON_PHONE = TEST_PHONE_NUMBERS[4] ?? "";
const SALON_PHONE_DIGITS = SALON_PHONE.replace(/\D/g, "");
const TEST_PHONE_DIGITS = TEST_PHONE.replace(/\D/g, "");

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

const INSTRUCTIONS = {
  depositAmount: 31,
  phone: SALON_PHONE,
  recipient: "Salon Testowy",
  title: "Zadatek wizyta 25.11 10:00",
};

type Props = Parameters<typeof BookingConfirmation>[0];

function props(over: Partial<Props> = {}): Props {
  return {
    salonId: "salon-a",
    salonName: "Salon Testowy",
    selectedService: SERVICE,
    selectedVariant: null,
    assignedEmployees: [],
    selectedEmployeeId: "",
    selectedDate: "2026-11-25",
    selectedTimeSlot: "10:00",
    effectiveDuration: 60,
    baseEffectivePrice: 100,
    effectivePrice: 100,
    bestDiscountAmount: 0,
    activePromoType: "none",
    happyHoursPromo: null,
    firstVisitPromo: null,
    depositRequired: true,
    depositAmount: 30,
    selectedPaymentMethod: "stripe",
    blikPhoneNumber: "",
    blikInstructions: null,
    isLoggedIn: false,
    onReset: () => {},
    ...over,
  };
}

const BLIK_IDS = [
  "blik-instructions",
  "blik-instructions-missing",
  "blik-refund-notice",
  "blik-save-notice",
  "blik-amount",
  "blik-phone",
  "blik-recipient",
  "blik-title",
];

const REFUND_TEXT = "Zadatek rozliczany poza MyHelper — zwrot ustala salon.";
const SAVE_TEXT = "Zapisz dane przelewu — nie wyslemy ich SMS-em.";
const MISSING_TEXT =
  "Nie udalo sie wyswietlic danych przelewu zadatku. Jesli salon wymaga zadatku, skontaktuj sie z salonem.";

describe("flaga false — gałąź online bez zmian", () => {
  it("zadatek 30: oplacony, Karta, baner sukcesu; brak elementow BLIK", () => {
    const { container } = render(<BookingConfirmation {...props()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("30 PLN (oplacony)");
    expect(text).toContain("Karta");
    expect(text).toContain("zostal pomyslnie oplacony");
    expect(screen.queryByTestId("blik-instructions")).toBeNull();
    expect(screen.queryByTestId("blik-refund-notice")).toBeNull();
    expect(screen.queryByTestId("blik-instructions-missing")).toBeNull();
  });
});

describe("flaga true — instrukcje BLIK", () => {
  it("gosc: kwota i dane z serwera, reszta liczona od kwoty serwera, bez slow o oplaceniu i SMS", () => {
    flags.blik = true;
    const { container } = render(
      <BookingConfirmation {...props({ blikInstructions: INSTRUCTIONS })} />
    );
    expect(screen.getByTestId("blik-amount").textContent).toBe("31.00 PLN");
    expect(screen.getByTestId("blik-phone").textContent).toBe(SALON_PHONE);
    expect(screen.getByTestId("blik-recipient").textContent).toBe(INSTRUCTIONS.recipient);
    expect(screen.getByTestId("blik-title").textContent).toBe(INSTRUCTIONS.title);

    const remainingRow = screen.getByText("Pozostalo do zaplaty w salonie:").parentElement;
    expect(remainingRow?.textContent).toContain("69 PLN");

    const text = container.textContent ?? "";
    for (const forbidden of [
      "oplacony",
      "Karta",
      "BLIK P2P",
      "Metoda platnosci",
      "Wizyta jest potwierdzona",
      "SMS",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(screen.getByTestId("blik-refund-notice").textContent?.trim()).toBe(REFUND_TEXT);
  });

  it("zalogowany z instrukcjami: zdanie o zapisaniu danych przelewu", () => {
    flags.blik = true;
    render(
      <BookingConfirmation {...props({ blikInstructions: INSTRUCTIONS, isLoggedIn: true })} />
    );
    expect(screen.getByTestId("blik-save-notice").textContent?.trim()).toBe(SAVE_TEXT);
  });
});

describe("flaga true — brak instrukcji", () => {
  it.each([
    ["zalogowany", true],
    ["gosc", false],
  ])("%s: komunikat o braku danych, bez kwoty i numeru, zdanie o zwrocie obecne", (_label, isLoggedIn) => {
    flags.blik = true;
    const { container } = render(
      <BookingConfirmation {...props({ blikInstructions: null, isLoggedIn })} />
    );
    expect(screen.getByTestId("blik-instructions-missing").textContent?.trim()).toBe(MISSING_TEXT);
    expect(screen.queryByTestId("blik-save-notice")).toBeNull();
    expect(screen.queryByTestId("blik-amount")).toBeNull();
    expect(screen.getByTestId("blik-refund-notice").textContent?.trim()).toBe(REFUND_TEXT);

    const digits = (container.textContent ?? "").replace(/\D/g, "");
    expect(digits).not.toContain(SALON_PHONE_DIGITS);
    expect(container.textContent).not.toContain("oplacony");
  });
});

describe("flaga true — przypadki brzegowe", () => {
  it("rezerwacja bez zadatku: brak elementow BLIK i slowa oplacony", () => {
    flags.blik = true;
    const { container } = render(
      <BookingConfirmation
        {...props({ depositRequired: false, depositAmount: 0, blikInstructions: INSTRUCTIONS })}
      />
    );
    for (const id of BLIK_IDS) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(container.textContent).not.toContain("oplacony");
  });

  it("telefon BLIK klienta z formularza nie pojawia sie na ekranie", () => {
    flags.blik = true;
    const { container } = render(
      <BookingConfirmation
        {...props({
          selectedPaymentMethod: "blik",
          blikPhoneNumber: TEST_PHONE,
          blikInstructions: INSTRUCTIONS,
        })}
      />
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Telefon BLIK");
    expect(text).not.toContain(TEST_PHONE);
    expect(text.replace(/\D/g, "")).not.toContain(TEST_PHONE_DIGITS);
  });

  it("numer telefonu salonu nie trafia do konsoli", () => {
    flags.blik = true;
    const spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    render(<BookingConfirmation {...props({ blikInstructions: INSTRUCTIONS })} />);
    cleanup();
    render(
      <BookingConfirmation {...props({ blikInstructions: INSTRUCTIONS, isLoggedIn: true })} />
    );
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const logged = call.map((arg) => String(arg)).join(" ").replace(/\D/g, "");
        expect(logged).not.toContain(SALON_PHONE_DIGITS);
      }
    }
  });
});

describe("przycisk kolejnej rezerwacji", () => {
  it.each([false, true])("flaga %s: woła onReset", (blik) => {
    flags.blik = blik;
    const onReset = vi.fn();
    render(
      <BookingConfirmation {...props({ blikInstructions: INSTRUCTIONS, onReset })} />
    );
    fireEvent.click(screen.getByText("Zarezerwuj kolejna wizyte"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

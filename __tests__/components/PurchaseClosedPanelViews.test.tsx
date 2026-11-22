/**
 * Baner okresu próbnego na stronie głównej panelu (DashboardTrialBanner)
 * i widok „Brak aktywnej subskrypcji” (NoSubscription) a przełącznik zakupu
 * planu (`isPlanPurchaseOpen()`).
 *
 * Zakup zamknięty (wartość z prawdziwego modułu, false): baner w ostatnich
 * 3 dniach mówi o trybie tylko do odczytu, bez wezwania do zakupu, z etykietą
 * „Szczegóły”; widok bez subskrypcji zamiast „Wybierz plan” podaje kontakt.
 * Zakup otwarty (atrapa modułu features): wezwanie do zakupu, „Wykup teraz”,
 * „Wybierz plan”. Poza ostatnimi 3 dniami baner nie podaje liczby dni okresu
 * próbnego (salon może mieć własną datę końca).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoSubscription } from "@/app/dashboard/subscription/_components/no-subscription";
import { PURCHASE_CLOSED_CONTACT_TEXT } from "@/app/dashboard/subscription/_components/trial-notice";
import { DashboardTrialBanner } from "@/components/dashboard/dashboard-trial-banner";

const hoisted = vi.hoisted(() => ({
  purchaseOpen: false,
  real: false,
  subscription: { isTrialing: true, trialDaysRemaining: 2 as number | null },
}));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  hoisted.real = actual.isPlanPurchaseOpen();
  return {
    ...actual,
    isPlanPurchaseOpen: () => hoisted.purchaseOpen,
  };
});

vi.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => hoisted.subscription,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const READ_ONLY_TEXT =
  "Po zakończeniu okresu próbnego panel przejdzie w tryb tylko do odczytu.";

beforeEach(() => {
  hoisted.subscription = { isTrialing: true, trialDaysRemaining: 2 };
});

describe("zakup zamknięty (wartość z modułu)", () => {
  beforeEach(() => {
    hoisted.purchaseOpen = hoisted.real;
  });

  it("prawdziwy isPlanPurchaseOpen() zwraca false", () => {
    expect(hoisted.real).toBe(false);
  });

  it("baner, 2 dni do końca: zdanie o trybie tylko do odczytu, link „Szczegóły” do panelu subskrypcji, brak „Wykup”", () => {
    render(<DashboardTrialBanner />);

    expect(screen.getByText(READ_ONLY_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Szczegóły/ })).toHaveAttribute(
      "href",
      "/dashboard/subscription",
    );
    expect(screen.queryByText(/Wykup/)).toBeNull();
  });

  it("baner, 3 dni do końca (granica): nadal zdanie o trybie tylko do odczytu", () => {
    hoisted.subscription = { isTrialing: true, trialDaysRemaining: 3 };
    render(<DashboardTrialBanner />);

    expect(screen.getByText(READ_ONLY_TEXT)).toBeInTheDocument();
  });

  it("baner, 10 dni do końca: zdanie bez liczby dni okresu próbnego, etykieta „Zarzadzaj”", () => {
    hoisted.subscription = { isTrialing: true, trialDaysRemaining: 10 };
    render(<DashboardTrialBanner />);

    expect(
      screen.getByText("Korzystasz z pełnych funkcji w okresie próbnym."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/14-dniowego/)).toBeNull();
    expect(screen.getByRole("link", { name: /Zarzadzaj/ })).toBeInTheDocument();
  });

  it("baner bez okresu próbnego albo bez liczby dni: nic nie renderuje", () => {
    hoisted.subscription = { isTrialing: false, trialDaysRemaining: 2 };
    const { container, unmount } = render(<DashboardTrialBanner />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    hoisted.subscription = { isTrialing: true, trialDaysRemaining: null };
    const second = render(<DashboardTrialBanner />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("brak subskrypcji: zdanie kontaktowe zamiast „Wybierz plan”, brak odnośnika do cennika", () => {
    render(<NoSubscription />);

    expect(screen.getByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybierz plan/ })).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("zakup otwarty (atrapa)", () => {
  beforeEach(() => {
    hoisted.purchaseOpen = true;
  });

  it("baner, 2 dni do końca: wezwanie do zakupu i link „Wykup teraz”", () => {
    render(<DashboardTrialBanner />);

    expect(
      screen.getByText("Wykup subskrypcję, aby zachować pełny dostęp po okresie próbnym."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Wykup teraz/ })).toHaveAttribute(
      "href",
      "/dashboard/subscription",
    );
    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it("brak subskrypcji: link „Wybierz plan” do /pricing, brak zdania kontaktowego", () => {
    render(<NoSubscription />);

    expect(screen.getByRole("link", { name: /Wybierz plan/ })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.queryByText(PURCHASE_CLOSED_CONTACT_TEXT)).toBeNull();
  });
});

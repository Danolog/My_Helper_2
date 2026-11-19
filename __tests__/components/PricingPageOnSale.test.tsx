/**
 * Cennik (PricingPage) a SOLD_PLAN_SLUG.
 *
 * Test renderuje PricingPage i sprawdza, który plan z odpowiedzi
 * /api/subscription-plans trafia na kartę, jaki tekst ceny stoi w
 * data-testid="plan-price", czy na stronie nie ma planu Pro, jaki adres
 * dostaje router.push po kliknięciu każdego z dwóch przycisków zakupu przez
 * niezalogowanego użytkownika oraz co strona pokazuje, gdy odpowiedź API nie
 * ma planu o slugu SOLD_PLAN_SLUG.
 *
 * Atrapy: globalny fetch (odpowiedź /api/subscription-plans z planami Basic
 * 49.00 i Pro 149.00, w jednym przypadku tylko z planem Pro), next/navigation
 * (useRouter().push to jedno współdzielone vi.fn), @/lib/auth-client (brak
 * sesji), @/lib/api-client, sonner oraz @/lib/plan-catalog. Atrapa
 * @/lib/plan-catalog przepuszcza prawdziwy moduł, a SOLD_PLAN_SLUG czyta
 * z przełącznika, który domyślnie ma wartość z prawdziwego modułu. Grupa
 * z przełącznikiem w beforeAll ustawia go na "pro", a w afterAll przywraca
 * wartość z prawdziwego modułu.
 *
 * Test NIE sprawdza trasy /api/subscription-plans, zakupu przez
 * zalogowanego użytkownika (mutationFetch, Stripe) ani szkieletu ładowania.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import PricingPage from "@/app/(site)/pricing/page";
import { TRIAL_DAYS } from "@/lib/constants";
import { PLAN_SUMMARY } from "@/lib/plan-features";

const hoisted = vi.hoisted(() => ({
  push: vi.fn(),
  soldPlanSlug: { real: "", current: "" },
}));

vi.mock("@/lib/plan-catalog", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/plan-catalog")>();
  hoisted.soldPlanSlug.real = actual.SOLD_PLAN_SLUG;
  hoisted.soldPlanSlug.current = actual.SOLD_PLAN_SLUG;
  return {
    ...actual,
    get SOLD_PLAN_SLUG() {
      return hoisted.soldPlanSlug.current;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.push, refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const BASIC = {
  id: "p1",
  name: "Basic",
  slug: "basic",
  priceMonthly: "49.00",
  features: ["Pozycja z bazy"],
  isActive: true,
};

const PRO = {
  id: "p2",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  features: ["Pozycja z bazy"],
  isActive: true,
};

const LOAD_ERROR = "Nie udalo sie zaladowac planow cenowych. Sprobuj ponownie pozniej.";
const CARD_BUTTON = "Zacznij za darmo";
const BOTTOM_BUTTON = `Zacznij ${TRIAL_DAYS} dni za darmo`;

function stubPlans(plans: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== "/api/subscription-plans") {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ success: true, data: plans }) };
    })
  );
}

beforeEach(() => {
  stubPlans([BASIC, PRO]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PricingPage — SOLD_PLAN_SLUG z modułu", () => {
  it('plan-price = "49 zł netto + 23% VAT"; na stronie brak tekstu pasującego do /49 PLN|149/', async () => {
    render(<PricingPage />);

    expect((await screen.findByTestId("plan-price")).textContent).toBe("49 zł netto + 23% VAT");
    expect(document.body.textContent).not.toMatch(/49 PLN|149/);
  });

  it("brak PLAN_SUMMARY.pro, przycisku z „Pro” w nazwie i tekstu /\\bPro\\b/", async () => {
    render(<PricingPage />);

    await screen.findByTestId("plan-price");
    expect(screen.queryByText(PLAN_SUMMARY.pro)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pro/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bPro\b/);
  });

  it.each([CARD_BUTTON, BOTTOM_BUTTON])(
    "kliknięcie przycisku „%s” przez niezalogowanego → push raz z /register?plan=basic",
    async (name) => {
      const user = userEvent.setup();
      render(<PricingPage />);

      await user.click(await screen.findByRole("button", { name }));

      expect(hoisted.push).toHaveBeenCalledTimes(1);
      expect(hoisted.push).toHaveBeenCalledWith("/register?plan=basic");
    }
  );

  it("odpowiedź API tylko z planem Pro → komunikat błędu ładowania planów, brak plan-price", async () => {
    stubPlans([PRO]);
    render(<PricingPage />);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-price")).not.toBeInTheDocument();
  });
});

describe('PricingPage — SOLD_PLAN_SLUG przełączony na "pro"', () => {
  beforeAll(() => {
    hoisted.soldPlanSlug.current = "pro";
  });

  afterAll(() => {
    hoisted.soldPlanSlug.current = hoisted.soldPlanSlug.real;
  });

  it('karta pokazuje nazwę "Pro" i plan-price = "149 zł netto + 23% VAT"', async () => {
    render(<PricingPage />);

    expect((await screen.findByTestId("plan-price")).textContent).toBe("149 zł netto + 23% VAT");
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.queryByText("Basic")).not.toBeInTheDocument();
  });

  it.each([CARD_BUTTON, BOTTOM_BUTTON])(
    "kliknięcie przycisku „%s” przez niezalogowanego → push raz z /register?plan=pro",
    async (name) => {
      const user = userEvent.setup();
      render(<PricingPage />);

      await user.click(await screen.findByRole("button", { name }));

      expect(hoisted.push).toHaveBeenCalledTimes(1);
      expect(hoisted.push).toHaveBeenCalledWith("/register?plan=pro");
    }
  );
});

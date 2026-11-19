/**
 * Cennik (PricingPage) a SOLD_PLAN_SLUG.
 *
 * Test renderuje PricingPage i sprawdza, który plan z odpowiedzi
 * /api/subscription-plans trafia na kartę, jaki tekst ceny stoi w
 * data-testid="plan-price", czy na stronie nie ma planu Pro, tekstu „AI”
 * ani opisu PLAN_SUMMARY.basic, jaki adres dostaje router.push po kliknięciu
 * każdego z dwóch przycisków zakupu przez niezalogowanego użytkownika, czy
 * niezalogowany widzi pod kartą tekst o okresie próbnym, jakie nazwy mają oba
 * przyciski dla zalogowanego, czy zalogowany nie widzi tekstu o okresie
 * próbnym i czy kliknięcie przycisku przez zalogowanego woła mutationFetch,
 * a nie router.push, oraz co strona pokazuje, gdy odpowiedź API nie ma planu
 * o slugu SOLD_PLAN_SLUG.
 *
 * Atrapy: globalny fetch (odpowiedź /api/subscription-plans z planami Basic
 * 49.00 i Pro 149.00, w jednym przypadku tylko z planem Pro), next/navigation
 * (useRouter().push to jedno współdzielone vi.fn), @/lib/auth-client (sesja
 * z przełącznika: domyślnie brak sesji, w grupie zalogowanego obiekt z polem
 * user), @/lib/api-client (mutationFetch to vi.fn; w grupie zalogowanego
 * zwraca odpowiedź { success: true } bez adresu płatności), sonner oraz
 * @/lib/plan-catalog. Atrapa @/lib/plan-catalog przepuszcza prawdziwy moduł,
 * a SOLD_PLAN_SLUG czyta z przełącznika, który domyślnie ma wartość
 * z prawdziwego modułu. Grupa z przełącznikiem w beforeAll ustawia go na
 * "pro", a w afterAll przywraca wartość z prawdziwego modułu.
 *
 * Test NIE sprawdza trasy /api/subscription-plans, argumentów wywołania
 * mutationFetch, przekierowania do płatności, komunikatów błędów zakupu ani
 * szkieletu ładowania.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import PricingPage from "@/app/(site)/pricing/page";
import { mutationFetch } from "@/lib/api-client";
import { TRIAL_DAYS } from "@/lib/constants";
import { PLAN_SUMMARY } from "@/lib/plan-features";

const hoisted = vi.hoisted(() => ({
  push: vi.fn(),
  soldPlanSlug: { real: "", current: "" },
  session: { current: null as null | { user: { id: string } } },
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
  useSession: () => ({ data: hoisted.session.current, isPending: false }),
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
const PAID_BUTTON = "Wykup subskrypcje";
const TRIAL_NOTE = "14 dni okresu probnego bez zobowiazan";

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
    expect(screen.queryAllByText(/49 PLN|149/)).toHaveLength(0);
  });

  it("brak PLAN_SUMMARY.pro, przycisku z „Pro” w nazwie i tekstu /\\bPro\\b/", async () => {
    render(<PricingPage />);

    await screen.findByTestId("plan-price");
    expect(screen.queryByText(PLAN_SUMMARY.pro)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pro/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bPro\b/);
    expect(screen.queryAllByText(/\bPro\b/)).toHaveLength(0);
  });

  it("na stronie brak tekstu pasującego do /\\bAI\\b/ i opisu PLAN_SUMMARY.basic", async () => {
    render(<PricingPage />);

    await screen.findByTestId("plan-price");
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
    expect(screen.queryAllByText(/\bAI\b/)).toHaveLength(0);
    expect(screen.queryByText(PLAN_SUMMARY.basic)).not.toBeInTheDocument();
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

  it("niezalogowany widzi tekst „14 dni okresu probnego bez zobowiazan”", async () => {
    render(<PricingPage />);

    await screen.findByTestId("plan-price");
    expect(screen.getByText(TRIAL_NOTE)).toBeInTheDocument();
  });

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

describe("PricingPage — użytkownik zalogowany", () => {
  beforeAll(() => {
    hoisted.session.current = { user: { id: "u1" } };
  });

  afterAll(() => {
    hoisted.session.current = null;
  });

  beforeEach(() => {
    vi.mocked(mutationFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  it("dwa przyciski „Wykup subskrypcje”, brak przycisku z „za darmo” w nazwie i tekstu „14 dni okresu probnego bez zobowiazan”", async () => {
    render(<PricingPage />);

    await screen.findByTestId("plan-price");
    expect(screen.getAllByRole("button", { name: PAID_BUTTON })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /za darmo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(TRIAL_NOTE)).not.toBeInTheDocument();
  });

  it.each([0, 1])(
    "kliknięcie przycisku „Wykup subskrypcje” nr %i → mutationFetch raz, push ani razu",
    async (index) => {
      const user = userEvent.setup();
      render(<PricingPage />);

      const buttons = await screen.findAllByRole("button", { name: PAID_BUTTON });
      await user.click(buttons[index]!);

      await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
      expect(hoisted.push).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: PAID_BUTTON })).toHaveLength(2)
      );
    }
  );
});

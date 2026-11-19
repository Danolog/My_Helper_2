/**
 * Sekcja cennika strony /dla-salonow (DlaSalonowPricing) a SOLD_PLAN_SLUG.
 *
 * Test renderuje DlaSalonowPricing i sprawdza, jaki tekst ceny stoi
 * w data-testid="plan-price" dla ceny z odpowiedzi /api/subscription-plans,
 * czy w sekcji nie ma tekstu „PLN” ani „149”, tekstu „Pro”, opisu
 * PLAN_SUMMARY.pro, linku z „plan=pro”, tekstu „AI” ani opisu
 * PLAN_SUMMARY.basic, jaki href ma link „Zacznij za darmo” i czy jest jedynym
 * linkiem do /register, co sekcja pokazuje, gdy odpowiedź API nie ma planu
 * o slugu SOLD_PLAN_SLUG albo gdy fetch zwraca ok: false, oraz jaką nazwę,
 * cenę i href karty pokazuje przy SOLD_PLAN_SLUG przełączonym na "pro".
 *
 * Atrapy: globalny fetch (odpowiedź /api/subscription-plans z planami Basic
 * 49.00 i Pro 149.00; w jednym przypadku Basic 59.00, w jednym tylko plan
 * Pro, w jednym odpowiedź ok: false), next/link (zwykły element <a> z href),
 * framer-motion (motion.div to zwykły <div> bez animacji) oraz
 * @/lib/plan-catalog. Atrapa @/lib/plan-catalog przepuszcza prawdziwy moduł,
 * a SOLD_PLAN_SLUG czyta z przełącznika, który domyślnie ma wartość
 * z prawdziwego modułu. Grupa z przełącznikiem w beforeAll ustawia go na
 * "pro", a w afterAll przywraca wartość z prawdziwego modułu.
 *
 * Test NIE sprawdza trasy /api/subscription-plans, listy funkcji na karcie
 * (sprawdza ją PlanFeaturesSingleSource.test.tsx), nagłówka sekcji, linku do
 * /pricing, szkieletu ładowania ani animacji.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { DlaSalonowPricing } from "@/app/(site)/dla-salonow/_components/DlaSalonowPricing";
import { PLAN_SUMMARY } from "@/lib/plan-features";

const hoisted = vi.hoisted(() => ({
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

// Animacje wejścia nie są przedmiotem testu.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
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
const CARD_LINK = "Zacznij za darmo";

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

function registerLinks(): HTMLAnchorElement[] {
  return screen
    .queryAllByRole("link")
    .filter((el): el is HTMLAnchorElement =>
      (el.getAttribute("href") ?? "").startsWith("/register")
    );
}

beforeEach(() => {
  stubPlans([BASIC, PRO]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DlaSalonowPricing — SOLD_PLAN_SLUG z modułu", () => {
  it('plan-price = "49 zł netto + 23% VAT"; brak tekstu /PLN|149/', async () => {
    render(<DlaSalonowPricing />);

    expect((await screen.findByTestId("plan-price")).textContent).toBe("49 zł netto + 23% VAT");
    expect(document.body.textContent).not.toMatch(/PLN|149/);
    expect(screen.queryAllByText(/PLN|149/)).toHaveLength(0);
  });

  it('cena z odpowiedzi API: Basic 59.00 → plan-price "59 zł netto + 23% VAT"', async () => {
    stubPlans([{ ...BASIC, priceMonthly: "59.00" }, PRO]);
    render(<DlaSalonowPricing />);

    expect((await screen.findByTestId("plan-price")).textContent).toBe("59 zł netto + 23% VAT");
  });

  it('na wyrenderowanej sekcji brak tekstu pasującego do /\\bPro\\b/, brak PLAN_SUMMARY.pro, brak linku z "plan=pro"', async () => {
    render(<DlaSalonowPricing />);

    await screen.findByTestId("plan-price");
    expect(document.body.textContent).not.toMatch(/\bPro\b/);
    expect(screen.queryAllByText(/\bPro\b/)).toHaveLength(0);
    expect(screen.queryByText(PLAN_SUMMARY.pro)).not.toBeInTheDocument();
    expect(
      screen.queryAllByRole("link").filter((el) => (el.getAttribute("href") ?? "").includes("plan=pro"))
    ).toHaveLength(0);
  });

  it("brak tekstu /\\bAI\\b/ i opisu PLAN_SUMMARY.basic", async () => {
    render(<DlaSalonowPricing />);

    await screen.findByTestId("plan-price");
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
    expect(screen.queryAllByText(/\bAI\b/)).toHaveLength(0);
    expect(screen.queryByText(PLAN_SUMMARY.basic)).not.toBeInTheDocument();
  });

  it('link "Zacznij za darmo" ma href /register?plan=basic; jedyny link do /register', async () => {
    render(<DlaSalonowPricing />);

    const link = await screen.findByRole("link", { name: CARD_LINK });
    expect(link.getAttribute("href")).toBe("/register?plan=basic");
    expect(registerLinks()).toEqual([link]);
  });

  it("odpowiedź API tylko z planem Pro → komunikat błędu, brak plan-price i brak linku /register", async () => {
    stubPlans([PRO]);
    render(<DlaSalonowPricing />);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-price")).not.toBeInTheDocument();
    expect(registerLinks()).toHaveLength(0);
  });

  it("fetch ok:false → komunikat błędu, brak plan-price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    render(<DlaSalonowPricing />);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-price")).not.toBeInTheDocument();
  });
});

describe('DlaSalonowPricing — SOLD_PLAN_SLUG przełączony na "pro"', () => {
  beforeAll(() => {
    hoisted.soldPlanSlug.current = "pro";
  });

  afterAll(() => {
    hoisted.soldPlanSlug.current = hoisted.soldPlanSlug.real;
  });

  it('karta "Pro", plan-price "149 zł netto + 23% VAT", href /register?plan=pro', async () => {
    render(<DlaSalonowPricing />);

    expect((await screen.findByTestId("plan-price")).textContent).toBe("149 zł netto + 23% VAT");
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.queryByText("Basic")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: CARD_LINK }).getAttribute("href")).toBe(
      "/register?plan=pro"
    );
  });
});

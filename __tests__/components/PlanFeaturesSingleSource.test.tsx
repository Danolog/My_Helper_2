/**
 * Strażnik jednego źródła list funkcji planów.
 *
 * Każde miejsce interfejsu, które pokazuje listę funkcji planu, renderuje
 * DOKŁADNIE to, co zwraca `src/lib/plan-features.ts` — bez pozycji wpisanych
 * ręcznie. Test renderuje komponenty i porównuje pokazane pozycje z wynikiem
 * funkcji z jednego źródła (równość list, nie „zawiera”).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DlaSalonowPricing } from "@/app/(site)/dla-salonow/_components/DlaSalonowPricing";
import PricingPage from "@/app/(site)/pricing/page";
import { PlanActions } from "@/app/dashboard/subscription/_components/plan-actions";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { isPlanOnSale } from "@/lib/plan-catalog";
import {
  PLAN_FEATURES,
  PLAN_SUMMARY,
  featuresFor,
  planHighlights,
  proOnlyFeatures,
} from "@/lib/plan-features";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

// Animacje wejścia nie są przedmiotem testu.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));

function texts(elements: HTMLElement[]): string[] {
  return elements.map((el) => el.textContent?.trim() ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("jedno źródło list funkcji planów — to, co widzi użytkownik", () => {
  it("strona sprzedażowa: karty planów pokazują skrót z plan-features", () => {
    render(<DlaSalonowPricing />);

    expect(texts(screen.getAllByTestId("plan-feature-basic"))).toEqual(
      planHighlights("basic", 5)
    );
    expect(texts(screen.getAllByTestId("plan-feature-pro"))).toEqual(planHighlights("pro", 4));
    expect(screen.getByText(PLAN_SUMMARY.basic)).toBeInTheDocument();
    expect(screen.getByText(PLAN_SUMMARY.pro)).toBeInTheDocument();
  });

  it("tworzenie salonu: karty planów z PLANS_ON_SALE pokazują skrót z plan-features", () => {
    render(
      <CreateSalonPrompt
        session={{ user: { name: "Anna", email: "anna@example.com" } }}
        onCreated={vi.fn()}
      />
    );

    const onSale = (["basic", "pro"] as const).filter((slug) => isPlanOnSale(slug));
    expect(texts(screen.getAllByRole("listitem"))).toEqual(
      onSale.flatMap((slug) => planHighlights(slug, 4))
    );
  });

  describe("cennik", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                id: "p1",
                name: "Basic",
                slug: "basic",
                priceMonthly: "49.00",
                features: ["Pozycja z bazy"],
                isActive: true,
              },
              {
                id: "p2",
                name: "Pro",
                slug: "pro",
                priceMonthly: "149.00",
                features: [...PLAN_FEATURES.pro],
                isActive: true,
              },
            ],
          }),
        }))
      );
    });

    it('karta planu pokazuje listę featuresFor("basic", …), a nie listę features z odpowiedzi API', async () => {
      render(<PricingPage />);

      await waitFor(() => {
        expect(screen.getAllByTestId("plan-feature").length).toBeGreaterThan(0);
      });

      expect(texts(screen.getAllByTestId("plan-feature"))).toEqual(
        featuresFor("basic", ["Pozycja z bazy"])
      );
      expect(screen.queryByText("Pozycja z bazy")).not.toBeInTheDocument();
    });
  });

  it("dialog obniżenia planu: lista utraconych funkcji = funkcje tylko w Pro", async () => {
    const user = userEvent.setup();
    const plan = {
      id: "p2",
      name: "Pro",
      slug: "pro",
      priceMonthly: "149.00",
      features: [...PLAN_FEATURES.pro],
    };
    const basic = {
      id: "p1",
      name: "Basic",
      slug: "basic",
      priceMonthly: "49.00",
      features: [...PLAN_FEATURES.basic],
    };

    render(
      <PlanActions
        subscription={
          {
            status: "active",
            cancelAtPeriodEnd: false,
            scheduledPlanId: null,
            currentPeriodEnd: "2026-12-01T00:00:00.000Z",
          } as never
        }
        plan={plan as never}
        allPlans={{ basic, pro: plan } as never}
        purchaseBlockedUntil={null}
        changePlanLoading={false}
        downgradeLoading={false}
        cancelLoading={false}
        onChangePlan={vi.fn()}
        onDowngrade={vi.fn()}
        onCancel={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Zmien na Basic/i }));

    const list = await screen.findByTestId("downgrade-lost-features");
    expect(texts(within(list).getAllByRole("listitem"))).toEqual(proOnlyFeatures());
  });
});

/**
 * Przycisk „Zmien na Pro” w panelu subskrypcji a lista PLANS_ON_SALE.
 *
 * Test renderuje `PlanActions` dla planu Basic albo Pro i sprawdza, które
 * przyciski akcji są na stronie: „Zmien na Pro”, „Zmien na Basic”,
 * „Anuluj subskrypcje”, a w jednym przypadku — że po kliknięciu „Zmien na Pro”
 * otwiera się okno z przyciskiem „Potwierdz upgrade do Pro”.
 *
 * Atrapa: `@/lib/plan-catalog` zachowuje resztę modułu, a `isPlanOnSale`
 * zależy od przełącznika `catalog.withPro`. Przy `false` (ustawianym
 * w `beforeEach` i `afterEach`) wywołanie trafia do prawdziwego
 * `isPlanOnSale`, czyli do listy z modułu („prawdziwa lista”). Przy `true`
 * zwraca true dla "pro", a dla pozostałych slugów woła prawdziwe
 * `isPlanOnSale` („lista z pro”). Atrapą jest też `next/link`.
 *
 * Test NIE sprawdza trasy zakupu ani zawartości okien poza nazwanym
 * przyciskiem potwierdzenia.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlanActions } from "@/app/dashboard/subscription/_components/plan-actions";
import { PLAN_FEATURES } from "@/lib/plan-features";

const catalog = vi.hoisted(() => ({ withPro: false }));
const purchase = vi.hoisted(() => ({ open: false }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, isPlanPurchaseOpen: () => purchase.open };
});

vi.mock("@/lib/plan-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-catalog")>();
  return {
    ...actual,
    isPlanOnSale: (slug: unknown) =>
      catalog.withPro && slug === "pro" ? true : actual.isPlanOnSale(slug),
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

interface PlanFixture {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
}

const basic: PlanFixture = {
  id: "p1",
  name: "Basic",
  slug: "basic",
  priceMonthly: "49.00",
  features: [...PLAN_FEATURES.basic],
};
const pro: PlanFixture = {
  id: "p2",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  features: [...PLAN_FEATURES.pro],
};

function renderActions(
  plan: PlanFixture,
  status: "active" | "trialing" | "canceled",
  purchaseBlockedUntil: string | null = null,
) {
  render(
    <PlanActions
      subscription={
        {
          status,
          cancelAtPeriodEnd: false,
          scheduledPlanId: null,
          currentPeriodEnd: "2026-12-01T00:00:00.000Z",
        } as never
      }
      plan={plan as never}
      allPlans={{ basic, pro } as never}
      purchaseBlockedUntil={purchaseBlockedUntil as never}
      changePlanLoading={false}
      downgradeLoading={false}
      cancelLoading={false}
      onChangePlan={vi.fn()}
      onDowngrade={vi.fn()}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />
  );
}

const upgradeButton = () =>
  screen.queryByRole("button", { name: "Zmien na Pro" });
const downgradeButton = () =>
  screen.queryByRole("button", { name: "Zmien na Basic" });
const cancelButton = () =>
  screen.queryByRole("button", { name: "Anuluj subskrypcje" });

beforeEach(() => {
  catalog.withPro = false;
  purchase.open = false;
});

afterEach(() => {
  catalog.withPro = false;
  vi.clearAllMocks();
});

describe("PlanActions — przycisk „Zmien na Pro” a lista PLANS_ON_SALE", () => {
  describe("prawdziwa lista", () => {
    it("plan Basic, status active: brak przycisku „Zmien na Pro”, jest przycisk „Anuluj subskrypcje”", () => {
      renderActions(basic, "active");

      expect(upgradeButton()).toBeNull();
      expect(cancelButton()).not.toBeNull();
    });

    it("plan Basic, status trialing: brak przycisku „Zmien na Pro”", () => {
      renderActions(basic, "trialing");

      expect(upgradeButton()).toBeNull();
    });

    it("plan Pro, status active, bez zaplanowanej zmiany: jest przycisk „Zmien na Basic”, brak przycisku „Zmien na Pro”", () => {
      renderActions(pro, "active");

      expect(downgradeButton()).not.toBeNull();
      expect(upgradeButton()).toBeNull();
    });
  });

  describe("lista z pro (atrapa)", () => {
    beforeEach(() => {
      catalog.withPro = true;
    });

    it("plan Basic, status active: jest przycisk „Zmien na Pro”, po kliknięciu okno ma przycisk „Potwierdz upgrade do Pro”", async () => {
      const user = userEvent.setup();
      renderActions(basic, "active");

      const button = upgradeButton();
      expect(button).not.toBeNull();
      await user.click(button as HTMLElement);

      expect(
        await screen.findByRole("button", { name: "Potwierdz upgrade do Pro" })
      ).not.toBeNull();
    });

    it("plan Pro, status active, bez zaplanowanej zmiany: brak przycisku „Zmien na Pro”, jest przycisk „Zmien na Basic”", () => {
      renderActions(pro, "active");

      expect(upgradeButton()).toBeNull();
      expect(downgradeButton()).not.toBeNull();
    });
  });
});

describe("PlanActions — „Aktywuj ponownie” a zamknięty zakup planu", () => {
  const reactivateLink = () =>
    screen.queryByRole("link", { name: /Aktywuj ponownie/ });

  it("zakup zamknięty: anulowana subskrypcja nie dostaje odnośnika do cennika", () => {
    renderActions(basic, "canceled");
    expect(reactivateLink()).toBeNull();
  });

  it("zakup otwarty: anulowana subskrypcja dostaje „Aktywuj ponownie” do /pricing", () => {
    purchase.open = true;
    renderActions(basic, "canceled");
    expect(reactivateLink()).toHaveAttribute("href", "/pricing");
  });

  it("zakup otwarty, ale zakup zablokowany do końca dostępu: bez odnośnika", () => {
    purchase.open = true;
    renderActions(basic, "canceled", "2026-12-01T00:00:00.000Z");
    expect(reactivateLink()).toBeNull();
  });

  it("zakup otwarty, subskrypcja aktywna: bez odnośnika", () => {
    purchase.open = true;
    renderActions(basic, "active");
    expect(reactivateLink()).toBeNull();
  });
});

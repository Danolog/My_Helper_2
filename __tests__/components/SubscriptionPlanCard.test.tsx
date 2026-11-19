/**
 * Karta planu w panelu subskrypcji: akcje i komunikaty zgodne ze stanem
 * dostępu z serwera (`access`) i z wierszem subskrypcji.
 *
 * Przy pełnym dostępie w stanie `canceled` albo `past_due` z terminem
 * i prawdziwą subskrypcją Stripe panel nie proponuje ponownego zakupu,
 * tylko podaje termin, po którym będzie on możliwy.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CurrentPlanCard } from "@/app/dashboard/subscription/_components/current-plan-card";
import type {
  AccessData,
  PlanData,
  SubscriptionData,
} from "@/app/dashboard/subscription/_types";

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

const NOW = new Date("2026-11-19T12:00:00.000Z");
const UNTIL = "2026-12-19T12:00:00.000Z";
const REAL_ID = "sub_1Real";

const BLOCKED_TEXT = "Nowy zakup bedzie mozliwy po 19 grudnia 2026.";
const NEW_PURCHASE_AFTER_TEXT = "Nowy zakup bedzie mozliwy po tym terminie.";
const CONTACT_SUPPORT_TEXT = "W sprawie zaleglej platnosci skontaktuj sie z obsluga.";

const PLAN: PlanData = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  features: ["Wszystko z planu Basic", "Asystent AI"],
  isActive: true,
};

function subscription(overrides: Partial<SubscriptionData>): SubscriptionData {
  return {
    id: "sub-row-1",
    salonId: "salon-1",
    planId: PLAN.id,
    stripeSubscriptionId: REAL_ID,
    stripeCustomerId: "cus_1",
    status: "canceled",
    trialEndsAt: null,
    currentPeriodStart: "2026-11-19T12:00:00.000Z",
    currentPeriodEnd: UNTIL,
    canceledAt: "2026-11-10T12:00:00.000Z",
    scheduledPlanId: null,
    scheduledChangeAt: null,
    createdAt: "2026-10-19T12:00:00.000Z",
    ...overrides,
  };
}

function access(overrides: Partial<AccessData>): AccessData {
  return { state: "canceled", mode: "full", planSlug: "pro", until: UNTIL, ...overrides };
}

const READ_ONLY: Partial<AccessData> = { mode: "read_only", planSlug: null, until: null };

function renderCard(sub: SubscriptionData, accessData: AccessData | null) {
  return render(
    <CurrentPlanCard
      subscription={sub}
      plan={PLAN}
      allPlans={{ pro: PLAN }}
      scheduledPlan={null}
      access={accessData}
      changePlanLoading={false}
      downgradeLoading={false}
      cancelLoading={false}
      cancelDowngradeLoading={false}
      onChangePlan={vi.fn()}
      onDowngrade={vi.fn()}
      onCancel={vi.fn()}
      onCancelDowngrade={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

function reactivateLink() {
  return screen.queryByRole("link", { name: /Aktywuj ponownie/ });
}

beforeEach(() => {
  // Only Date is faked, so user-event timers keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("karta planu: ponowny zakup a stan dostępu", () => {
  it("canceled z pełnym dostępem i prawdziwą subskrypcją Stripe: bez linku „Aktywuj ponownie”, z terminem nowego zakupu", () => {
    renderCard(subscription({}), access({}));

    expect(reactivateLink()).toBeNull();
    expect(screen.getByText(BLOCKED_TEXT)).toBeInTheDocument();
    expect(
      screen.getByText(
        `Anulowano: 10 listopada 2026. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${NEW_PURCHASE_AFTER_TEXT}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mozesz w kazdej chwili/)).toBeNull();
  });

  it("canceled z pełnym dostępem bez subskrypcji Stripe: link „Aktywuj ponownie” do /pricing, bez terminu nowego zakupu", () => {
    renderCard(subscription({ stripeSubscriptionId: null }), access({}));

    expect(reactivateLink()).toHaveAttribute("href", "/pricing");
    expect(screen.queryByText(BLOCKED_TEXT)).toBeNull();
    expect(
      screen.getByText(
        "Anulowano: 10 listopada 2026. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. Mozesz w kazdej chwili ponownie aktywowac plan.",
      ),
    ).toBeInTheDocument();
  });

  it("canceled po terminie (tylko odczyt) z prawdziwą subskrypcją Stripe: link „Aktywuj ponownie” jest", () => {
    renderCard(subscription({ currentPeriodEnd: "2026-11-01T12:00:00.000Z" }), access(READ_ONLY));

    expect(reactivateLink()).toHaveAttribute("href", "/pricing");
    expect(screen.queryByText(/Nowy zakup bedzie mozliwy/)).toBeNull();
  });

  it("past_due z pełnym dostępem i prawdziwą subskrypcją Stripe: termin nowego zakupu, bez linku, komunikat z instrukcją", () => {
    renderCard(
      subscription({ status: "past_due", canceledAt: null }),
      access({ state: "past_due" }),
    );

    expect(reactivateLink()).toBeNull();
    expect(screen.getByText(BLOCKED_TEXT)).toBeInTheDocument();
    expect(
      screen.getByText(
        `Ostatnia platnosc nie powiodla sie. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${NEW_PURCHASE_AFTER_TEXT} ${CONTACT_SUPPORT_TEXT}`,
      ),
    ).toBeInTheDocument();
  });

  it("past_due bez pełnego dostępu: bez linku, bez terminu nowego zakupu, komunikat z instrukcją", () => {
    renderCard(
      subscription({ status: "past_due", canceledAt: null, currentPeriodEnd: "2026-11-01T12:00:00.000Z" }),
      access({ state: "past_due", ...READ_ONLY }),
    );

    expect(reactivateLink()).toBeNull();
    expect(screen.queryByText(/Nowy zakup bedzie mozliwy/)).toBeNull();
    expect(
      screen.getByText(`Ostatnia platnosc nie powiodla sie. ${CONTACT_SUPPORT_TEXT}`),
    ).toBeInTheDocument();
  });
});

describe("karta planu: dialog anulowania", () => {
  it("active z prawdziwą subskrypcją Stripe i końcem okresu w przyszłości: dialog podaje dostęp do końca okresu i termin nowego zakupu", async () => {
    const user = userEvent.setup();
    renderCard(subscription({ status: "active", canceledAt: null }), access({ state: "active" }));

    expect(screen.queryByText(/Nowy zakup bedzie mozliwy/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Anuluj subskrypcje/ }));

    expect(
      await screen.findByText(
        "Zachowasz dostep do wszystkich funkcji planu Pro do konca biezacego okresu rozliczeniowego (19 grudnia 2026). Po tym terminie subskrypcja nie zostanie odnowiona.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(NEW_PURCHASE_AFTER_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/Mozesz ponownie aktywowac/)).toBeNull();
  });

  it("active bez subskrypcji Stripe: dialog pozwala na ponowną aktywację w dowolnym momencie", async () => {
    const user = userEvent.setup();
    renderCard(
      subscription({ status: "active", canceledAt: null, stripeSubscriptionId: null }),
      access({ state: "active" }),
    );

    await user.click(screen.getByRole("button", { name: /Anuluj subskrypcje/ }));

    expect(
      await screen.findByText("Mozesz ponownie aktywowac subskrypcje w dowolnym momencie."),
    ).toBeInTheDocument();
    expect(screen.queryByText(NEW_PURCHASE_AFTER_TEXT)).toBeNull();
  });

  it("active z końcem okresu w przeszłości: dialog bez obietnicy dostępu", async () => {
    const user = userEvent.setup();
    renderCard(
      subscription({ status: "active", canceledAt: null, currentPeriodEnd: "2026-11-01T12:00:00.000Z" }),
      access({ state: "active" }),
    );

    await user.click(screen.getByRole("button", { name: /Anuluj subskrypcje/ }));

    expect(await screen.findByText("Subskrypcja nie zostanie odnowiona.")).toBeInTheDocument();
    expect(screen.queryByText(/Zachowasz dostep/)).toBeNull();
  });

  it("trialing: brak przycisku „Anuluj subskrypcje”", () => {
    renderCard(
      subscription({
        status: "trialing",
        canceledAt: null,
        stripeSubscriptionId: null,
        trialEndsAt: "2026-11-29T12:00:00.000Z",
      }),
      access({ state: "trialing", until: "2026-11-29T12:00:00.000Z" }),
    );

    expect(screen.queryByRole("button", { name: /Anuluj subskrypcje/ })).toBeNull();
  });
});

describe("karta planu: nagłówek listy funkcji", () => {
  it("tylko odczyt: nagłówek z nazwą planu wiersza", () => {
    renderCard(subscription({ currentPeriodEnd: "2026-11-01T12:00:00.000Z" }), access(READ_ONLY));

    expect(screen.getByRole("heading", { name: "Funkcje planu Pro" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Funkcje w Twoim planie" })).toBeNull();
  });

  it("pełny dostęp: nagłówek „Funkcje w Twoim planie”", () => {
    renderCard(subscription({ status: "active", canceledAt: null }), access({ state: "active" }));

    expect(screen.getByRole("heading", { name: "Funkcje w Twoim planie" })).toBeInTheDocument();
  });
});

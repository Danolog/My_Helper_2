import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";

// Mock Next.js Link
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

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Crown: () => <span data-testid="crown-icon" />,
  Sparkles: () => <span data-testid="sparkles-icon" />,
  ArrowRight: () => <span data-testid="arrow-right-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
}));

// Mock constants
vi.mock("@/lib/constants", () => ({
  PLANS: {
    basic: { slug: "basic", name: "Basic", priceMonthly: 49 },
    pro: { slug: "pro", name: "Pro", priceMonthly: 149 },
  },
}));

// Mock subscription hook
let mockSubscriptionState = {
  isProPlan: false,
  loading: false,
};

vi.mock("@/hooks/use-subscription", () => ({
  useSubscription: () => mockSubscriptionState,
}));

describe("ProPlanGate", () => {
  beforeEach(() => {
    mockSubscriptionState = { isProPlan: false, loading: false };
  });

  const defaultProps = {
    featureName: "Asystent AI",
    featureDescription: "Zaawansowany asystent sztucznej inteligencji",
    proBenefits: [
      "Automatyczne odpowiedzi na wiadomosci",
      "Generowanie tresci marketingowych",
    ],
    children: <div data-testid="pro-content">Pro content here</div>,
  };

  it("renders children when user has Pro plan", () => {
    mockSubscriptionState = { isProPlan: true, loading: false };
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.getByTestId("pro-content")).toBeInTheDocument();
    expect(screen.getByText("Pro content here")).toBeInTheDocument();
  });

  it("renders loading skeleton when subscription is loading", () => {
    mockSubscriptionState = { isProPlan: false, loading: true };
    const { container } = render(<ProPlanGate {...defaultProps} />);

    // Should not render children
    expect(screen.queryByTestId("pro-content")).not.toBeInTheDocument();
    // Should render skeleton elements
    expect(container.querySelector("[data-slot='skeleton']")).toBeInTheDocument();
  });

  it("renders upgrade prompt for Basic plan users", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.getByText("Asystent AI")).toBeInTheDocument();
    expect(
      screen.getByText("Zaawansowany asystent sztucznej inteligencji")
    ).toBeInTheDocument();
    expect(screen.getByText("Tylko Plan Pro")).toBeInTheDocument();
  });

  it("renders pro benefits in the upgrade prompt", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(
      screen.getByText("Automatyczne odpowiedzi na wiadomosci")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Generowanie tresci marketingowych")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Co zyskujesz z Planem Pro:")
    ).toBeInTheDocument();
  });

  it("renders upgrade and compare buttons", () => {
    render(<ProPlanGate {...defaultProps} />);

    const upgradeLink = screen.getByText("Zmien na Pro").closest("a");
    expect(upgradeLink).toHaveAttribute("href", "/dashboard/subscription");

    const compareLink = screen.getByText("Porownaj plany").closest("a");
    expect(compareLink).toHaveAttribute("href", "/pricing");
  });

  it("renders pricing information", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.getByText(/149 PLN\/miesiac/)).toBeInTheDocument();
  });

  it("does not render benefits section when proBenefits is empty", () => {
    render(<ProPlanGate {...defaultProps} proBenefits={[]} />);

    expect(
      screen.queryByText("Co zyskujesz z Planem Pro:")
    ).not.toBeInTheDocument();
  });

  it("does not show children for Basic plan users", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.queryByTestId("pro-content")).not.toBeInTheDocument();
  });

  it("renders lock icon for gated feature", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.getByTestId("lock-icon")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  Lock: () => <span data-testid="lock-icon" />,
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

  it("renders feature name, description and AI unavailability message for Basic plan users", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.getByText("Asystent AI")).toBeInTheDocument();
    expect(
      screen.getByText("Zaawansowany asystent sztucznej inteligencji")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Funkcje AI nie są jeszcze dostępne w Twoim planie.")
    ).toBeInTheDocument();
  });

  it("does not render the benefits list or its heading", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(
      screen.queryByText("Automatyczne odpowiedzi na wiadomosci")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Generowanie tresci marketingowych")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Co zyskujesz z Planem Pro:")
    ).not.toBeInTheDocument();
  });

  it("does not render any link or button", () => {
    const { container } = render(<ProPlanGate {...defaultProps} />);

    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders no element whose text contains the word Pro, PLN, 149 or plan comparison", () => {
    render(<ProPlanGate {...defaultProps} />);

    expect(screen.queryAllByText(/\bPro\b|PLN|149|Por[oó]wnaj/)).toHaveLength(0);
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  RotateCcw: () => <span data-testid="rotate-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

describe("FormRecoveryBanner", () => {
  const mockOnRestore = vi.fn();
  const mockOnDismiss = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the recovery message", () => {
    render(
      <FormRecoveryBanner
        onRestore={mockOnRestore}
        onDismiss={mockOnDismiss}
      />
    );

    expect(
      screen.getByText(
        "Znaleziono niezapisane dane formularza. Przywrocic?"
      )
    ).toBeInTheDocument();
  });

  it("renders restore button", () => {
    render(
      <FormRecoveryBanner
        onRestore={mockOnRestore}
        onDismiss={mockOnDismiss}
      />
    );

    expect(screen.getByText("Przywroc")).toBeInTheDocument();
  });

  it("renders dismiss button with accessible label", () => {
    render(
      <FormRecoveryBanner
        onRestore={mockOnRestore}
        onDismiss={mockOnDismiss}
      />
    );

    expect(
      screen.getByRole("button", { name: "Odrzuc zapisane dane" })
    ).toBeInTheDocument();
  });

  it("calls onRestore and hides banner when restore is clicked", async () => {
    render(
      <FormRecoveryBanner
        onRestore={mockOnRestore}
        onDismiss={mockOnDismiss}
      />
    );

    await user.click(screen.getByText("Przywroc"));

    expect(mockOnRestore).toHaveBeenCalledTimes(1);
    // Banner should disappear after restore
    expect(
      screen.queryByText("Znaleziono niezapisane dane formularza. Przywrocic?")
    ).not.toBeInTheDocument();
  });

  it("calls onDismiss and hides banner when dismiss is clicked", async () => {
    render(
      <FormRecoveryBanner
        onRestore={mockOnRestore}
        onDismiss={mockOnDismiss}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Odrzuc zapisane dane" })
    );

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    // Banner should disappear after dismiss
    expect(
      screen.queryByText("Znaleziono niezapisane dane formularza. Przywrocic?")
    ).not.toBeInTheDocument();
  });
});

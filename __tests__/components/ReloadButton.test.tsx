import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReloadButton } from "@/components/reload-button";

// Mock lucide-react
vi.mock("lucide-react", () => ({
  RefreshCw: () => <span data-testid="refresh-icon" />,
}));

describe("ReloadButton", () => {
  const user = userEvent.setup();
  const mockReload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.reload
    Object.defineProperty(window, "location", {
      value: { reload: mockReload },
      writable: true,
      configurable: true,
    });
  });

  it("renders the button with correct text", () => {
    render(<ReloadButton />);

    expect(
      screen.getByRole("button", { name: /Sprobuj ponownie/ })
    ).toBeInTheDocument();
  });

  it("renders the refresh icon", () => {
    render(<ReloadButton />);

    expect(screen.getByTestId("refresh-icon")).toBeInTheDocument();
  });

  it("calls window.location.reload when clicked", async () => {
    render(<ReloadButton />);

    await user.click(
      screen.getByRole("button", { name: /Sprobuj ponownie/ })
    );

    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});

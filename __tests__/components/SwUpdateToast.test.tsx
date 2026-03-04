import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwUpdateToast } from "@/components/pwa/sw-update-toast";

// Mock lucide-react
vi.mock("lucide-react", () => ({
  RefreshCw: () => <span data-testid="refresh-icon" />,
}));

describe("SwUpdateToast", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing by default", () => {
    const { container } = render(<SwUpdateToast />);
    expect(container.innerHTML).toBe("");
  });

  it("renders toast when sw-update-available event fires", () => {
    render(<SwUpdateToast />);

    act(() => {
      window.dispatchEvent(new CustomEvent("sw-update-available"));
    });

    expect(
      screen.getByText("Dostepna nowa wersja aplikacji")
    ).toBeInTheDocument();
    expect(screen.getByText("Odswierz")).toBeInTheDocument();
  });

  it("renders refresh icon in the toast", () => {
    render(<SwUpdateToast />);

    act(() => {
      window.dispatchEvent(new CustomEvent("sw-update-available"));
    });

    expect(screen.getByTestId("refresh-icon")).toBeInTheDocument();
  });

  it("attempts to skip waiting when refresh is clicked", async () => {
    const mockPostMessage = vi.fn();
    const mockGetRegistration = vi.fn().mockResolvedValue({
      waiting: { postMessage: mockPostMessage },
    });

    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistration: mockGetRegistration },
      writable: true,
      configurable: true,
    });

    render(<SwUpdateToast />);

    act(() => {
      window.dispatchEvent(new CustomEvent("sw-update-available"));
    });

    await user.click(screen.getByText("Odswierz"));

    expect(mockGetRegistration).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfflineBanner } from "@/components/offline-banner";

// Mock the network status hook
let mockNetworkStatus = {
  isOnline: true,
  wasOffline: false,
  lastOfflineAt: null as Date | null,
};

vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => mockNetworkStatus,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  WifiOff: () => <span data-testid="wifi-off-icon" />,
  Wifi: () => <span data-testid="wifi-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
}));

describe("OfflineBanner", () => {
  beforeEach(() => {
    mockNetworkStatus = {
      isOnline: true,
      wasOffline: false,
      lastOfflineAt: null,
    };
  });

  it("renders nothing when online and was never offline", () => {
    const { container } = render(<OfflineBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders offline warning when not online", () => {
    mockNetworkStatus = {
      isOnline: false,
      wasOffline: false,
      lastOfflineAt: new Date(),
    };

    render(<OfflineBanner />);

    expect(
      screen.getByText(/Brak polaczenia z internetem/)
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders wifi-off icon when offline", () => {
    mockNetworkStatus = {
      isOnline: false,
      wasOffline: false,
      lastOfflineAt: new Date(),
    };

    render(<OfflineBanner />);

    expect(screen.getByTestId("wifi-off-icon")).toBeInTheDocument();
  });

  it("renders refresh button when offline", () => {
    mockNetworkStatus = {
      isOnline: false,
      wasOffline: false,
      lastOfflineAt: new Date(),
    };

    render(<OfflineBanner />);

    expect(screen.getByText("Odswierz")).toBeInTheDocument();
  });

  it("renders reconnected message when back online after being offline", () => {
    mockNetworkStatus = {
      isOnline: true,
      wasOffline: true,
      lastOfflineAt: new Date(),
    };

    render(<OfflineBanner />);

    expect(
      screen.getByText(/Polaczenie przywrocone/)
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders wifi icon when reconnected", () => {
    mockNetworkStatus = {
      isOnline: true,
      wasOffline: true,
      lastOfflineAt: new Date(),
    };

    render(<OfflineBanner />);

    expect(screen.getByTestId("wifi-icon")).toBeInTheDocument();
  });
});

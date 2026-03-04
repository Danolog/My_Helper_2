import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { InstallPrompt } from "@/components/pwa/install-prompt";

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Download: () => <span data-testid="download-icon" />,
}));

describe("InstallPrompt", () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Mock localStorage (happy-dom's localStorage.clear is not a standard function)
    originalLocalStorage = window.localStorage;
    const store: Record<string, string> = {};
    Object.defineProperty(window, "localStorage", {
      writable: true,
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          Object.keys(store).forEach((key) => delete store[key]);
        }),
        get length() {
          return Object.keys(store).length;
        },
        key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
      },
    });

    // Default: not standalone
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "localStorage", {
      writable: true,
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("renders nothing initially (no beforeinstallprompt fired)", () => {
    const { container } = render(<InstallPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("renders banner after beforeinstallprompt event and delay", async () => {
    render(<InstallPrompt />);

    // Simulate the beforeinstallprompt event
    const promptEvent = new Event("beforeinstallprompt", {
      cancelable: true,
    });
    Object.defineProperty(promptEvent, "prompt", {
      value: vi.fn().mockResolvedValue({ outcome: "accepted" }),
    });
    Object.defineProperty(promptEvent, "platforms", {
      value: ["web"],
    });

    act(() => {
      window.dispatchEvent(promptEvent);
    });

    // Banner should not be visible yet (3 second delay)
    expect(screen.queryByText("Zainstaluj MyHelper")).not.toBeInTheDocument();

    // Advance timer past the 3 second delay
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(screen.getByText("Zainstaluj MyHelper")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dodaj aplikacje do ekranu glownego, aby miec szybki dostep."
      )
    ).toBeInTheDocument();
  });

  it("renders install and dismiss buttons in the banner", async () => {
    render(<InstallPrompt />);

    const promptEvent = new Event("beforeinstallprompt", {
      cancelable: true,
    });
    Object.defineProperty(promptEvent, "prompt", {
      value: vi.fn().mockResolvedValue({ outcome: "accepted" }),
    });
    Object.defineProperty(promptEvent, "platforms", {
      value: ["web"],
    });

    act(() => {
      window.dispatchEvent(promptEvent);
    });

    act(() => {
      vi.advanceTimersByTime(3500);
    });

    expect(screen.getByText("Zainstaluj")).toBeInTheDocument();
    expect(screen.getByText("Nie teraz")).toBeInTheDocument();
  });

  it("does not show banner when already in standalone mode", () => {
    // Override matchMedia to simulate standalone
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });

    render(<InstallPrompt />);

    // Even after event fires, banner should not show
    const promptEvent = new Event("beforeinstallprompt");
    act(() => {
      window.dispatchEvent(promptEvent);
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Zainstaluj MyHelper")).not.toBeInTheDocument();
  });

  it("does not show banner when dismissed recently", () => {
    // Simulate recent dismissal in localStorage
    localStorage.setItem("pwa-install-dismissed", String(Date.now()));

    render(<InstallPrompt />);

    const promptEvent = new Event("beforeinstallprompt");
    act(() => {
      window.dispatchEvent(promptEvent);
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Zainstaluj MyHelper")).not.toBeInTheDocument();
  });
});

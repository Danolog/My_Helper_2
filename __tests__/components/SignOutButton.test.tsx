import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "@/components/auth/sign-out-button";

// Mock Next.js navigation
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
}));

// Mock auth client
const mockSignOut = vi.fn();
let mockSessionData: {
  data: { user: { name: string } } | null;
  isPending: boolean;
} = {
  data: { user: { name: "Jan" } },
  isPending: false,
};

vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockSessionData,
}));

describe("SignOutButton", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionData = { data: { user: { name: "Jan" } }, isPending: false };
    // Mock navigator.serviceWorker
    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage: vi.fn() } },
      writable: true,
      configurable: true,
    });
  });

  it("renders sign out button when user is logged in", () => {
    render(<SignOutButton />);

    expect(
      screen.getByRole("button", { name: "Sign out" })
    ).toBeInTheDocument();
  });

  it("shows loading button when session is pending", () => {
    mockSessionData = { data: null, isPending: true };
    render(<SignOutButton />);

    expect(
      screen.getByRole("button", { name: "Loading..." })
    ).toBeDisabled();
  });

  it("renders nothing when there is no session", () => {
    mockSessionData = { data: null, isPending: false };
    const { container } = render(<SignOutButton />);

    expect(container.innerHTML).toBe("");
  });

  it("calls signOut and redirects on click", async () => {
    mockSignOut.mockResolvedValue({});

    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});

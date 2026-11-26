import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const postMessage = vi.fn();

describe("SignOutButton", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: { postMessage } },
      writable: true,
      configurable: true,
    });
  });

  it("renders a Polish sign-out button", () => {
    render(<SignOutButton />);

    expect(screen.getByRole("button", { name: "Wyloguj się" })).toBeEnabled();
  });

  it("clears SW caches, signs out and redirects to /login", async () => {
    mockSignOut.mockResolvedValue({ data: { success: true }, error: null });

    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHES" });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("disables the button while signing out", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockSignOut.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    expect(screen.getByRole("button", { name: "Wyloguj się" })).toBeDisabled();
    resolve({ data: { success: true }, error: null });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
  });

  it("works without a service worker", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    mockSignOut.mockResolvedValue({ data: { success: true }, error: null });

    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
  });

  it("on error: shows a message, stays on the page, button enabled again", async () => {
    mockSignOut.mockResolvedValue({ data: null, error: { message: "boom" } });

    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wylogować. Spróbuj ponownie."
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Wyloguj się" })).toBeEnabled();
  });
});

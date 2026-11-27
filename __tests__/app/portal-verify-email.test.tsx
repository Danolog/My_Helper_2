/**
 * Strona potwierdzenia e-maila w portalu klienta
 * (`src/app/(client)/portal/verify-email/page.tsx`).
 *
 * Po potwierdzeniu klient trafia do portalu (`clientHomePath()` — przy
 * zamrożonym katalogu „Moje wizyty”), nie do panelu salonu — konto klienta
 * nie ma salonu, a panel pokazałby mu zakładanie salonu. Atrapy:
 * `next/navigation` i globalny `fetch`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VerifyEmailPage from "@/app/(client)/portal/verify-email/page";

const nav = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() },
  token: "token-abc" as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.token ? { token: nav.token } : {}),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  nav.token = "token-abc";
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("portal/verify-email", () => {
  it("po potwierdzeniu: przycisk prowadzi do „Moich wizyt” (katalog zamrożony) i odświeża trasę", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, redirected: false });
    const user = userEvent.setup();
    render(<VerifyEmailPage />);

    const next = await screen.findByRole("button", { name: /portal/i });
    await user.click(next);

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-email?token=token-abc");
    expect(nav.router.replace).toHaveBeenCalledWith("/appointments");
    expect(nav.router.replace).not.toHaveBeenCalledWith("/salons");
    expect(nav.router.replace).not.toHaveBeenCalledWith("/dashboard");
    expect(nav.router.refresh).toHaveBeenCalledTimes(1);
  });

  it("błąd potwierdzenia: komunikat i linki, bez przekierowania", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      redirected: false,
      json: async () => ({ message: "Token expired" }),
    });
    render(<VerifyEmailPage />);

    expect(await screen.findByText("Token expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("brak tokenu: błąd bez zapytania do API", async () => {
    nav.token = null;
    render(<VerifyEmailPage />);

    expect(await screen.findByText("No verification token provided")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});

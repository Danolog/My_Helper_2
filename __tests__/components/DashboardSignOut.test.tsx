/**
 * Wylogowanie w panelu salonu.
 *
 * Panel ma własną nawigację (pasek boczny na desktopie, menu z nagłówka
 * i „Więcej” z dolnego paska na telefonie) i nie renderuje nagłówka strony,
 * w którym jest menu użytkownika. Wylogowanie musi więc być w nawigacji
 * panelu, a dla konta bez salonu (widok zakładania salonu, bez nawigacji)
 * w samym widoku zakładania. Po wylogowaniu: przejście na /login.
 * Atrapy: `@/lib/auth-client`, `next/navigation`, `next/link`.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import {
  DashboardMobileHeader,
  DashboardSidebar,
} from "@/components/dashboard/dashboard-sidebar";
import { RoleProvider } from "@/components/dashboard/role-provider";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  router: { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => mocks.signOut(...args),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => mocks.router,
}));

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

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const LABEL = "Wyloguj się";

beforeEach(() => {
  mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { controller: { postMessage: vi.fn() } },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function expectSignOutToLogin(button: HTMLElement) {
  const user = userEvent.setup();
  await user.click(button);
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/login"));
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
}

describe("pasek boczny panelu (desktop)", () => {
  it.each(["owner", "employee", "receptionist"] as const)(
    "rola %s: przycisk „Wyloguj się” prowadzi na /login",
    async (role) => {
      render(
        <RoleProvider role={role}>
          <DashboardSidebar />
        </RoleProvider>
      );

      await expectSignOutToLogin(screen.getByRole("button", { name: LABEL }));
    }
  );
});

describe("panel na telefonie", () => {
  it("menu z nagłówka ma „Wyloguj się”", async () => {
    const user = userEvent.setup();
    render(<DashboardMobileHeader />);

    await user.click(screen.getByRole("button", { name: /menu nawigacyjne/i }));
    const dialog = await screen.findByRole("dialog");

    await expectSignOutToLogin(within(dialog).getByRole("button", { name: LABEL }));
  });

  it("menu „Więcej” z dolnego paska ma „Wyloguj się”", async () => {
    const user = userEvent.setup();
    render(<DashboardBottomNav />);

    await user.click(screen.getByRole("button", { name: /pelne menu|pełne menu/i }));
    const dialog = await screen.findByRole("dialog");

    await expectSignOutToLogin(within(dialog).getByRole("button", { name: LABEL }));
  });
});

describe("konto bez salonu (widok zakładania salonu)", () => {
  it("ma przycisk „Wyloguj się” prowadzący na /login", async () => {
    render(
      <CreateSalonPrompt
        session={{ user: { name: "Anna", email: "anna@example.com" } }}
        legalForm={null}
      />
    );

    await expectSignOutToLogin(screen.getByRole("button", { name: LABEL }));
  });
});

describe("błąd wylogowania", () => {
  it("nie przechodzi na /login i pokazuje komunikat", async () => {
    mocks.signOut.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const user = userEvent.setup();
    render(<DashboardSidebar />);

    await user.click(screen.getByRole("button", { name: LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Nie udało się wylogować/);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: LABEL })).toBeEnabled();
  });

  it("błąd sieci: komunikat, bez przejścia", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<DashboardSidebar />);

    await user.click(screen.getByRole("button", { name: LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Nie udało się wylogować/);
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
});

/**
 * Layout panelu (`src/app/dashboard/layout.tsx`) a konto bez salonu.
 *
 * Konto bez salonu i bez aktywnego powiązania pracownika (`allowed: false`
 * z `requireDashboardAccess`) widzi wyłącznie zakładanie salonu: bez paska
 * bocznego, bez nawigacji i bez treści podstrony (`children`), niezależnie
 * od tego, czy to `/dashboard`, czy dowolna podstrona `/dashboard/*` — layout
 * jest wspólny. Do tego link „Jestem klientem” na `/salons`.
 *
 * Właściciel i pracownik z aktywnym powiązaniem (`allowed: true`) widzą panel
 * jak dotychczas. Atrapy: sesja, kontekst salonu, moduły i komponenty
 * nawigacji panelu (renderują znaczniki zamiast prawdziwego UI).
 */
import type { ReactElement, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "@/app/dashboard/layout";

const mocks = vi.hoisted(() => ({
  requireDashboardAccess: vi.fn(),
  getSalonContext: vi.fn(),
  getSalonModules: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  promptProps: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ requireDashboardAccess: mocks.requireDashboardAccess }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: mocks.getSalonContext }));
vi.mock("@/lib/server/modules", () => ({ getSalonModules: mocks.getSalonModules }));
vi.mock("@/components/dashboard/create-salon-prompt", () => ({
  CreateSalonPrompt: (props: Record<string, unknown>) => {
    mocks.promptProps(props);
    return <div data-testid="create-salon-prompt" />;
  },
}));
vi.mock("@/components/dashboard/command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));
vi.mock("@/components/dashboard/dashboard-bottom-nav", () => ({
  DashboardBottomNav: () => <div data-testid="bottom-nav" />,
}));
vi.mock("@/components/dashboard/dashboard-breadcrumbs", () => ({
  DashboardBreadcrumbs: () => <div data-testid="breadcrumbs" />,
}));
vi.mock("@/components/dashboard/dashboard-sidebar", () => ({
  DashboardSidebar: () => <div data-testid="sidebar" />,
  DashboardMobileHeader: () => <div data-testid="mobile-header" />,
}));
vi.mock("@/components/dashboard/modules-provider", () => ({
  ModulesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/dashboard/role-provider", () => ({
  RoleProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const SESSION = {
  session: { id: "sess-1", token: "secret-session-token", userId: "user-1" },
  user: { id: "user-1", name: "Anna", email: "anna@example.com" },
};

async function renderLayout(subpage: string) {
  const element = (await DashboardLayout({
    children: <div data-testid="subpage">{subpage}</div>,
  })) as ReactElement;
  render(element);
}

beforeEach(() => {
  mocks.getSalonContext.mockResolvedValue(null);
  mocks.getSalonModules.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("konto bez salonu (allowed: false)", () => {
  beforeEach(() => {
    mocks.requireDashboardAccess.mockResolvedValue({
      session: SESSION,
      allowed: false,
      role: null,
    });
  });

  it.each(["/dashboard", "/dashboard/appointments", "/dashboard/settings/modules"])(
    "%s: tylko zakładanie salonu, bez przekierowania, paska bocznego i podstrony",
    async (subpage) => {
      await renderLayout(subpage);

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(screen.getByTestId("create-salon-prompt")).toBeInTheDocument();
      expect(screen.queryByTestId("subpage")).toBeNull();
      expect(screen.queryByTestId("sidebar")).toBeNull();
      expect(screen.queryByTestId("mobile-header")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs")).toBeNull();
      expect(screen.queryByTestId("bottom-nav")).toBeNull();
      expect(screen.queryByTestId("command-palette")).toBeNull();
    }
  );

  it("link „Jestem klientem” prowadzi na /salons", async () => {
    await renderLayout("/dashboard");

    expect(screen.getByRole("link", { name: /Jestem klientem/ })).toHaveAttribute(
      "href",
      "/salons"
    );
  });

  it("do komponentu klienckiego trafia tylko imię i e-mail, bez tokenu sesji", async () => {
    await renderLayout("/dashboard");

    expect(mocks.promptProps).toHaveBeenCalledTimes(1);
    expect(mocks.promptProps.mock.calls[0]?.[0]).toEqual({
      session: { user: { name: "Anna", email: "anna@example.com" } },
    });
  });

  it("nie pyta o kontekst salonu ani o moduły", async () => {
    await renderLayout("/dashboard");

    expect(mocks.getSalonContext).not.toHaveBeenCalled();
    expect(mocks.getSalonModules).not.toHaveBeenCalled();
  });
});

describe.each([
  ["właściciel z salonem", "owner"],
  ["pracownik z aktywnym powiązaniem", "employee"],
  ["recepcja z aktywnym powiązaniem", "receptionist"],
] as const)("%s (allowed: true)", (_label, role) => {
  beforeEach(() => {
    mocks.requireDashboardAccess.mockResolvedValue({ session: SESSION, allowed: true, role });
    mocks.getSalonContext.mockResolvedValue({ salonId: "salon-1", role });
  });

  it("panel bez zmian: pasek boczny i podstrona, bez zakładania salonu", async () => {
    await renderLayout("/dashboard/appointments");

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("subpage")).toHaveTextContent("/dashboard/appointments");
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("create-salon-prompt")).toBeNull();
    expect(screen.queryByRole("link", { name: /Jestem klientem/ })).toBeNull();
    expect(mocks.getSalonModules).toHaveBeenCalledWith("salon-1");
  });
});

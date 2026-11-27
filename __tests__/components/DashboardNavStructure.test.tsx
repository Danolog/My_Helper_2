/**
 * Układ nawigacji panelu (plan wejścia na rynek, 4.3).
 *
 * Menu boczne: pięć pozycji (Dziś, Kalendarz, Klienci, Oferta, Wyniki) i pod
 * nimi rozwijane „Więcej” z dodatkami i ustawieniami. Dolny pasek na
 * telefonie: Dziś, Kalendarz, „+ Wizyta”, Klienci, Więcej. „Oferta” i
 * „Wyniki” to strony z kafelkami do istniejących podstron — żaden dawny
 * adres z menu nie znika. Role i filtr modułów jak dotąd.
 * Atrapy: `next/link`, `next/navigation`, `@/lib/auth-client`.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OfferHubPage from "@/app/dashboard/offer/page";
import ResultsHubPage from "@/app/dashboard/results/page";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import { SidebarNav } from "@/components/dashboard/dashboard-sidebar";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { RoleProvider } from "@/components/dashboard/role-provider";
import { DEFAULT_MODULES, MODULES, type ModulesState } from "@/lib/features";
import type { SalonRole } from "@/lib/salon-context";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

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

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  signOut: vi.fn(),
}));

afterEach(() => {
  cleanup();
  nav.pathname = "/dashboard";
});

const ALL_ON = Object.fromEntries(MODULES.map((m) => [m.key, true])) as ModulesState;

const PRIMARY_LABELS = ["Dziś", "Kalendarz", "Klienci", "Oferta", "Wyniki"];

function renderSidebar({
  role = "owner",
  modules = DEFAULT_MODULES,
  pathname = "/dashboard",
}: { role?: SalonRole; modules?: ModulesState; pathname?: string } = {}) {
  return render(
    <RoleProvider role={role}>
      <ModulesProvider modules={modules}>
        <SidebarNav pathname={pathname} />
      </ModulesProvider>
    </RoleProvider>
  );
}

function linkLabels(container: HTMLElement = document.body): string[] {
  return within(container)
    .queryAllByRole("link")
    .map((a) => a.textContent?.replace("PRO", "").trim() ?? "");
}

function linkHrefs(container: HTMLElement = document.body): string[] {
  return within(container)
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href") ?? "");
}

async function openMore() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Więcej" }));
}

describe("menu boczne: pięć pozycji", () => {
  it("właściciel widzi dokładnie 5 pozycji w kolejności, „Więcej” zwinięte", () => {
    renderSidebar({ modules: ALL_ON });

    expect(linkLabels()).toEqual(PRIMARY_LABELS);
    expect(screen.getByRole("button", { name: "Więcej" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("„Oferta” i „Wyniki” prowadzą na strony zbiorcze", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Oferta" })).toHaveAttribute(
      "href",
      "/dashboard/offer"
    );
    expect(screen.getByRole("link", { name: "Wyniki" })).toHaveAttribute(
      "href",
      "/dashboard/results"
    );
  });

  it.each([
    ["/dashboard/services", "Oferta"],
    ["/dashboard/employees/abc", "Oferta"],
    ["/dashboard/reports/revenue", "Wyniki"],
    ["/dashboard/payments", "Wyniki"],
    ["/dashboard/finance", "Wyniki"],
  ])("na %s aktywna jest pozycja „%s”", (pathname, label) => {
    renderSidebar({ pathname });

    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  });
});

describe("„Więcej” zawiera dodatki i ustawienia", () => {
  it("po rozwinięciu: rezerwacja, dodatki, subskrypcja i ustawienia", async () => {
    renderSidebar({ modules: ALL_ON });
    await openMore();

    expect(screen.getByRole("button", { name: "Więcej" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    const hrefs = linkHrefs();
    for (const href of [
      "/dashboard/booking",
      "/dashboard/products",
      "/dashboard/waiting-list",
      "/dashboard/gallery",
      "/dashboard/notifications",
      "/dashboard/ai-assistant",
      "/dashboard/subscription",
      "/dashboard/settings",
    ]) {
      expect(hrefs, href).toContain(href);
    }
  });

  it("na podstronie z „Więcej” grupa startuje rozwinięta", () => {
    renderSidebar({ pathname: "/dashboard/settings/salon" });

    expect(screen.getByRole("link", { name: "Ustawienia" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("drugie kliknięcie zwija grupę", async () => {
    renderSidebar();
    await openMore();
    await openMore();

    expect(linkLabels()).toEqual(PRIMARY_LABELS);
  });
});

describe("moduły wyłączone i zamrożone nadal ukryte", () => {
  it("zamrożone (faktury, opinie) nie pojawiają się nawet przy stanie true", async () => {
    renderSidebar({ modules: ALL_ON });
    await openMore();

    const hrefs = linkHrefs();
    expect(hrefs).not.toContain("/dashboard/invoices");
    expect(hrefs).not.toContain("/dashboard/reviews");
  });

  it("domyślnie wyłączone moduły (magazyn, lista oczekujących, promocje) ukryte", async () => {
    renderSidebar();
    await openMore();

    const hrefs = linkHrefs();
    expect(hrefs).not.toContain("/dashboard/products");
    expect(hrefs).not.toContain("/dashboard/waiting-list");
    expect(hrefs).not.toContain("/dashboard/promotions");
  });
});

describe("widok pracownika i recepcji bez zmian", () => {
  it("pracownik: Dziś i Kalendarz, w „Więcej” tylko Galeria", async () => {
    renderSidebar({ role: "employee", modules: ALL_ON });

    expect(linkLabels()).toEqual(["Dziś", "Kalendarz"]);
    await openMore();
    expect(linkHrefs()).toEqual(["/dashboard", "/dashboard/calendar", "/dashboard/gallery"]);
  });

  it("recepcja: Dziś, Kalendarz, Klienci, w „Więcej” tylko ręczna rezerwacja", async () => {
    renderSidebar({ role: "receptionist", modules: ALL_ON });

    expect(linkLabels()).toEqual(["Dziś", "Kalendarz", "Klienci"]);
    await openMore();
    expect(linkHrefs()).toEqual([
      "/dashboard",
      "/dashboard/calendar",
      "/dashboard/clients",
      "/dashboard/booking",
    ]);
  });

  it("wylogowanie zostaje na dole dla każdej roli", () => {
    renderSidebar({ role: "employee" });

    expect(screen.getByRole("button", { name: "Wyloguj się" })).toBeInTheDocument();
  });
});

describe("dolny pasek na telefonie", () => {
  function renderBottomNav(role: SalonRole) {
    return render(
      <RoleProvider role={role}>
        <DashboardBottomNav />
      </RoleProvider>
    );
  }

  it("właściciel: Dziś, Kalendarz, + Wizyta (środek), Klienci, Więcej", () => {
    renderBottomNav("owner");
    const bar = screen.getByRole("navigation", { name: "Szybka nawigacja" });

    expect(linkHrefs(bar)).toEqual([
      "/dashboard",
      "/dashboard/calendar",
      "/dashboard/booking",
      "/dashboard/clients",
    ]);
    expect(within(bar).getByRole("link", { name: "Dodaj wizytę" })).toHaveAttribute(
      "href",
      "/dashboard/booking"
    );
    expect(within(bar).queryByRole("link", { name: /AI/ })).not.toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: /pełne menu/i })).toBeInTheDocument();
  });

  it("pracownik: bez „+ Wizyta” i bez Klientów", () => {
    renderBottomNav("employee");
    const bar = screen.getByRole("navigation", { name: "Szybka nawigacja" });

    expect(linkHrefs(bar)).toEqual(["/dashboard", "/dashboard/calendar"]);
    expect(within(bar).getByRole("button", { name: /pełne menu/i })).toBeInTheDocument();
  });

  it("„Więcej” otwiera menu z rozwiniętymi dodatkami", async () => {
    renderBottomNav("owner");

    await userEvent.setup().click(screen.getByRole("button", { name: /pełne menu/i }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("link", { name: "Ustawienia" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Subskrypcja" })).toBeInTheDocument();
  });
});

describe("strony zbiorcze i dawne adresy", () => {
  it("Oferta: kafelki do usług i zespołu", () => {
    render(<OfferHubPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Oferta" })).toBeInTheDocument();
    expect(linkHrefs()).toEqual(
      expect.arrayContaining(["/dashboard/services", "/dashboard/employees"])
    );
  });

  it("Wyniki: kafelki do raportów, płatności i rozliczeń", () => {
    render(<ResultsHubPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Wyniki" })).toBeInTheDocument();
    expect(linkHrefs()).toEqual(
      expect.arrayContaining(["/dashboard/reports", "/dashboard/payments", "/dashboard/finance"])
    );
  });

  it.each(["employee", "receptionist"] as const)(
    "rola %s na stronie zbiorczej dostaje „Brak uprawnien”",
    (role) => {
      render(
        <RoleProvider role={role}>
          <OfferHubPage />
          <ResultsHubPage />
        </RoleProvider>
      );

      expect(screen.getAllByText("Brak uprawnien do tej sekcji")).toHaveLength(2);
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    }
  );

  it("każdy adres z dawnego menu jest osiągalny z menu albo strony zbiorczej", async () => {
    const formerHrefs = [
      "/dashboard",
      "/dashboard/calendar",
      "/dashboard/booking",
      "/dashboard/clients",
      "/dashboard/services",
      "/dashboard/employees",
      "/dashboard/products",
      "/dashboard/waiting-list",
      "/dashboard/notifications",
      "/dashboard/gallery",
      "/dashboard/promotions",
      "/dashboard/ai-assistant",
      "/dashboard/reports",
      "/dashboard/payments",
      "/dashboard/finance",
      "/dashboard/subscription",
      "/dashboard/settings",
    ];

    renderSidebar({ modules: ALL_ON });
    await openMore();
    const reachable = new Set(linkHrefs());
    cleanup();
    render(
      <>
        <OfferHubPage />
        <ResultsHubPage />
      </>
    );
    for (const href of linkHrefs()) reachable.add(href);

    for (const href of formerHrefs) {
      expect(reachable.has(href), href).toBe(true);
    }
  });
});

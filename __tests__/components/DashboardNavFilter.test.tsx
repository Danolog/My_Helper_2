/**
 * Strażnik filtra nawigacji panelu (przegląd #19).
 *
 * Menu boczne, dolna nawigacja i paleta poleceń pokazują pozycję tylko wtedy,
 * gdy jej moduł jest włączony i niezamrożony. Warunek żyje w jednej funkcji
 * `isRouteEnabledForModules` w rejestrze (`src/lib/features.ts`); trzy
 * miejsca ją wołają i nie mają własnych kopii.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidebarNav } from "@/components/dashboard/dashboard-sidebar";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import {
  DEFAULT_MODULES,
  MODULES,
  ROUTE_MODULE_MAP,
  isRouteEnabledForModules,
  type ModulesState,
} from "@/lib/features";

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
  usePathname: () => "/dashboard",
}));

const ALL_ON = Object.fromEntries(MODULES.map((m) => [m.key, true])) as ModulesState;

function hrefs(modules: ModulesState): string[] {
  const { unmount } = render(
    <ModulesProvider modules={modules}>
      <SidebarNav pathname="/dashboard" />
    </ModulesProvider>
  );
  const result = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
  unmount();
  return result;
}

describe("isRouteEnabledForModules", () => {
  it("trasa rdzenia jest zawsze widoczna", () => {
    expect(isRouteEnabledForModules("/dashboard", DEFAULT_MODULES)).toBe(true);
    expect(isRouteEnabledForModules("/dashboard/clients", DEFAULT_MODULES)).toBe(true);
    expect(isRouteEnabledForModules("/dashboard/calendar", DEFAULT_MODULES)).toBe(true);
  });

  it("trasa modułu przełączalnego zależy od stanu modułu salonu", () => {
    expect(isRouteEnabledForModules("/dashboard/products", DEFAULT_MODULES)).toBe(false);
    expect(
      isRouteEnabledForModules("/dashboard/products", { ...DEFAULT_MODULES, products: true })
    ).toBe(true);
    expect(isRouteEnabledForModules("/dashboard/products/abc", ALL_ON)).toBe(true);
  });

  it("trasa modułu zamrożonego jest ukryta nawet przy stanie true", () => {
    const frozenRoutes = ROUTE_MODULE_MAP.filter(
      (e) => MODULES.find((m) => m.key === e.module)?.hardOff
    );
    expect(frozenRoutes.length).toBeGreaterThan(0);
    for (const { prefix } of frozenRoutes) {
      expect(isRouteEnabledForModules(prefix, DEFAULT_MODULES), prefix).toBe(false);
      expect(isRouteEnabledForModules(prefix, ALL_ON), prefix).toBe(false);
    }
  });
});

describe("menu boczne używa filtra modułów", () => {
  it("domyślnie: bez pozycji modułów wyłączonych i zamrożonych, rdzeń jest", () => {
    const links = hrefs(DEFAULT_MODULES);

    expect(links).toContain("/dashboard/clients");
    expect(links).toContain("/dashboard/calendar");
    expect(links).not.toContain("/dashboard/products");
    expect(links).not.toContain("/dashboard/waiting-list");
    expect(links).not.toContain("/dashboard/promotions");
    expect(links).not.toContain("/dashboard/invoices");
  });

  it("włączony moduł przełączalny pojawia się w menu", () => {
    const links = hrefs({ ...DEFAULT_MODULES, products: true, waitingList: true });

    expect(links).toContain("/dashboard/products");
    expect(links).toContain("/dashboard/waiting-list");
    expect(links).not.toContain("/dashboard/promotions");
  });

  it("moduł zamrożony nie pojawia się w menu nawet przy stanie true", () => {
    const links = hrefs(ALL_ON);

    expect(links).toContain("/dashboard/products");
    expect(links).not.toContain("/dashboard/invoices");
  });

  it("każda pozycja menu przechodzi przez filtr — żadna nie omija rejestru", () => {
    for (const href of hrefs(DEFAULT_MODULES)) {
      expect(isRouteEnabledForModules(href, DEFAULT_MODULES), href).toBe(true);
    }
  });
});

describe("trzy miejsca nawigacji wołają jedną funkcję", () => {
  const files = [
    "src/components/dashboard/dashboard-sidebar.tsx",
    "src/components/dashboard/dashboard-bottom-nav.tsx",
    "src/components/dashboard/command-palette.tsx",
  ];

  it.each(files)("%s woła isRouteEnabledForModules i nie ma własnej kopii warunku", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).toMatch(/\bisRouteEnabledForModules\(/);
    // Własna kopia warunku: bezpośrednie pytanie o moduł trasy albo indeksowanie
    // stanu modułów kluczem trasy.
    expect(source).not.toMatch(/\bmoduleForRoute\(/);
    expect(source).not.toMatch(/modules\[moduleKey\]/);
  });
});

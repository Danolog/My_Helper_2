import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ModulesSettingsPage from "@/app/dashboard/settings/modules/page";
import {
  DEFAULT_MODULES,
  FROZEN_MODULES_NOTICE,
  MODULES,
  TOGGLEABLE_MODULES,
} from "@/lib/features";

// Mock Next.js Link
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

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Mock sonner toasts
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock auth session — zalogowany wlasciciel
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

// Mock api-client (PUT nie jest testowany tutaj)
vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const SALON_ID = "salon-1";

const MODULES_STATE = { ...DEFAULT_MODULES };

/**
 * Scenariusz bledu (bug 2026-07): salon ISTNIEJE (salons/mine go zwraca),
 * ale nie ma jeszcze adresu/telefonu/branzy — publiczny katalog GET /api/salons
 * odfiltrowuje go i zwraca pusta liste. Strona Moduly nie moze na tej
 * podstawie twierdzic, ze salonu nie ma.
 */
function mockFetchIncompleteSalon() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/salons/mine")) {
      return {
        json: async () => ({
          success: true,
          salon: { id: SALON_ID, name: "Salon Testowy" },
        }),
      } as Response;
    }
    if (url.includes(`/api/salons/${SALON_ID}/modules`)) {
      return {
        json: async () => ({ success: true, data: MODULES_STATE }),
      } as Response;
    }
    if (url.includes("/api/salons")) {
      // publiczny katalog: salon niekompletny -> odfiltrowany
      return {
        json: async () => ({ success: true, data: [], count: 0 }),
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("ModulesSettingsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchIncompleteSalon());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("pokazuje przelaczniki modulow gdy salon istnieje, ale jest niekompletny (nieobecny w publicznym katalogu)", async () => {
    render(<ModulesSettingsPage />);

    // Strona musi zaladowac moduly salonu z salons/mine, nie z katalogu
    await waitFor(() => {
      expect(screen.getByText("Magazyn")).toBeInTheDocument();
    });

    expect(screen.queryByText("Brak salonu")).not.toBeInTheDocument();
  });

  it("pokazuje tylko moduly przelaczalne — zamrozonych nie ma na liscie ani w bloku „Wkrótce”", async () => {
    render(<ModulesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Magazyn")).toBeInTheDocument();
    });

    for (const mod of TOGGLEABLE_MODULES) {
      expect(screen.getByText(mod.label)).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: mod.label })).toBeEnabled();
    }

    const frozen = MODULES.filter((m) => m.hardOff);
    expect(frozen.length).toBeGreaterThan(0);
    for (const mod of frozen) {
      expect(screen.queryByText(mod.label)).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: mod.label })).not.toBeInTheDocument();
    }

    // Zadnych obietnic przyszlych wydan.
    expect(document.body.textContent).not.toMatch(/wkr[óo]tce/i);
    expect(document.body.textContent).not.toMatch(/kolejnych wydaniach/i);
    expect(screen.getAllByRole("switch")).toHaveLength(TOGGLEABLE_MODULES.length);
  });

  it("informuje, ze faktury i program lojalnosciowy sa niedostepne, a dane zostaja", async () => {
    render(<ModulesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Magazyn")).toBeInTheDocument();
    });

    expect(FROZEN_MODULES_NOTICE).toBe(
      "Faktury i program lojalnościowy są obecnie niedostępne. Wystawione faktury i punkty klientów pozostają zapisane na koncie salonu."
    );
    expect(screen.getByTestId("frozen-modules-notice")).toHaveTextContent(FROZEN_MODULES_NOTICE!);
  });

  it("nie pobiera salonu z publicznego katalogu GET /api/salons (fallback bral cudzy salon)", async () => {
    render(<ModulesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Magazyn")).toBeInTheDocument();
    });

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => String(c[0])
    );
    const catalogCalls = calls.filter(
      (u) => /\/api\/salons\/?(\?|$)/.test(u) // dokladnie /api/salons, nie /mine ani /[id]/modules
    );
    expect(catalogCalls).toHaveLength(0);
  });

  it("pokazuje 'Brak salonu' tylko gdy uzytkownik faktycznie nie ma salonu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/salons/mine")) {
          return {
            json: async () => ({ success: true, salon: null }),
          } as Response;
        }
        return {
          json: async () => ({ success: true, data: [], count: 0 }),
        } as Response;
      })
    );

    render(<ModulesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Brak salonu")).toBeInTheDocument();
    });
  });
});

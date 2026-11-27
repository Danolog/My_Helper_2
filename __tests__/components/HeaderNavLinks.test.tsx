/**
 * Nawigacja nagłówka — linki panelu salonu tylko dla konta z salonem
 * (useSalonId => salons.ownerId), nie po user.role. Konto z rolą "owner"
 * bez salonu dostawało linki do panelu, z którego requireDashboardAccess
 * i tak je przekierowuje.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeaderNavLinks } from "@/components/header-nav-links";

let mockSession: { data: { user: Record<string, unknown> } | null; isPending: boolean };
let mockSalon: { salonId: string | null; loading: boolean };

vi.mock("@/lib/auth-client", () => ({ useSession: () => mockSession }));
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => mockSalon }));

describe("HeaderNavLinks", () => {
  beforeEach(() => {
    mockSession = { data: { user: { id: "u1" } }, isPending: false };
    mockSalon = { salonId: null, loading: false };
  });

  it("user.role='owner' bez salonu => linki klienta, nie panelu", () => {
    mockSession = { data: { user: { id: "u1", role: "owner" } }, isPending: false };
    render(<HeaderNavLinks />);
    expect(screen.queryByText("Pulpit")).toBeNull();
    expect(screen.getByText("Moje wizyty")).toBeInTheDocument();
  });

  it("klient bez salonu: katalog i ulubione zamrożone => tylko „Moje wizyty”", () => {
    render(<HeaderNavLinks />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/appointments"]);
  });

  it("gość: funkcje i cennik na stronie głównej, bez linku do katalogu", () => {
    mockSession = { data: null, isPending: false };
    render(<HeaderNavLinks />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/#features", "/#pricing"]);
  });

  it("konto z salonem (bez user.role) => linki panelu", () => {
    mockSalon = { salonId: "salon-1", loading: false };
    render(<HeaderNavLinks />);
    expect(screen.getByText("Pulpit")).toBeInTheDocument();
  });
});

/**
 * Stopka strony a dokumenty prawne (`publishedLegalLinks()`).
 *
 * Przy wartości z prawdziwego modułu (flaga wyłączona) stopka nie linkuje do
 * żadnej strony prawnej — każda odpowiada 404. Przy włączonej fladze (stan
 * podany do prawdziwej funkcji, z wersjami dokumentów) odnośniki pojawiają
 * się w wersji desktopowej i mobilnej. Opis marki nie obiecuje AI.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SiteFooter } from "@/components/site-footer";
import type { LegalDocuments } from "@/lib/legal/documents";

const state = vi.hoisted(() => ({ useRealModule: true }));

vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/documents")>();
  const versioned: LegalDocuments = {
    ...actual.LEGAL_DOCUMENTS,
    privacy: { ...actual.LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
    terms: { ...actual.LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
    dpa: { ...actual.LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
  };
  return {
    ...actual,
    publishedLegalLinks: () =>
      state.useRealModule
        ? actual.publishedLegalLinks()
        : actual.publishedLegalLinks(true, versioned),
  };
});

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

const LEGAL_HREFS = ["/privacy", "/terms", "/dpa", "/podprocesorzy", "/contact"];

function hrefs(): string[] {
  return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
}

describe("SiteFooter — dokumenty prawne nieopublikowane (wartość z modułu)", () => {
  beforeEach(() => {
    state.useRealModule = true;
  });

  it("brak odnośników do stron prawnych i nagłówka „Informacje”", () => {
    render(<SiteFooter />);

    for (const href of LEGAL_HREFS) {
      expect(hrefs()).not.toContain(href);
    }
    expect(screen.queryByText("Informacje")).toBeNull();
    expect(screen.queryByText(/Regulamin|Polityka prywatności|Kontakt/)).toBeNull();
  });

  it("pozostałe odnośniki zostają (rejestracja, cennik, salony)", () => {
    render(<SiteFooter />);

    expect(hrefs()).toEqual(
      expect.arrayContaining(["/register", "/pricing", "/salons", "/dla-klientow"]),
    );
  });

  it("opis marki bez AI i bez „Booksy”", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText("System rezerwacji online dla salonów usługowych."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAI\b|Booksy/);
  });
});

describe("SiteFooter — dokumenty prawne opublikowane (stan podany do funkcji)", () => {
  beforeEach(() => {
    state.useRealModule = false;
  });

  it("każda strona prawna w obu wersjach stopki, z tytułem dokumentu", () => {
    render(<SiteFooter />);

    const all = hrefs();
    for (const href of LEGAL_HREFS) {
      expect(all.filter((h) => h === href)).toHaveLength(2);
    }
    expect(screen.getByText("Informacje")).toBeInTheDocument();
    expect(screen.getAllByText("Polityka prywatności")).toHaveLength(2);
  });
});

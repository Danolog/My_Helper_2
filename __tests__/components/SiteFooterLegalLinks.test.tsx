/**
 * Stopka strony a flaga dokumentów prawnych (`areLegalDocsPublished()`).
 *
 * Przy wartości z prawdziwego modułu (false) stopka nie linkuje do
 * /privacy, /terms ani /contact — te strony jeszcze nie istnieją. Przy true
 * (atrapa modułu features) odnośniki wracają w wersji desktopowej
 * i mobilnej. Opis marki nie obiecuje AI.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SiteFooter } from "@/components/site-footer";

const flags = vi.hoisted(() => ({ legal: false, real: false }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  flags.real = actual.areLegalDocsPublished();
  return {
    ...actual,
    areLegalDocsPublished: () => flags.legal,
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

const LEGAL_HREFS = ["/privacy", "/terms", "/contact"];

function hrefs(): string[] {
  return screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
}

describe("SiteFooter — dokumenty prawne nieopublikowane (wartość z modułu)", () => {
  beforeEach(() => {
    flags.legal = flags.real;
  });

  it("prawdziwy areLegalDocsPublished() zwraca false", () => {
    expect(flags.real).toBe(false);
  });

  it("brak odnośników do /privacy, /terms i /contact oraz nagłówka „Informacje”", () => {
    render(<SiteFooter />);

    for (const href of LEGAL_HREFS) {
      expect(hrefs()).not.toContain(href);
    }
    expect(screen.queryByText("Informacje")).toBeNull();
    expect(screen.queryByText(/Regulamin/)).toBeNull();
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

describe("SiteFooter — dokumenty prawne opublikowane (atrapa)", () => {
  beforeEach(() => {
    flags.legal = true;
  });

  it("odnośniki do /privacy i /terms w obu wersjach stopki, /contact w wersji desktopowej", () => {
    render(<SiteFooter />);

    const all = hrefs();
    expect(all.filter((h) => h === "/privacy")).toHaveLength(2);
    expect(all.filter((h) => h === "/terms")).toHaveLength(2);
    expect(all.filter((h) => h === "/contact")).toHaveLength(1);
    expect(screen.getByText("Informacje")).toBeInTheDocument();
  });
});

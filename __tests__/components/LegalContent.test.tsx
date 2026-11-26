/**
 * Renderowanie treści dokumentu prawnego (`LegalContent`).
 *
 * Treść trafia na stronę jako elementy React: nagłówki, listy z numerami
 * z treści, tabele i odnośniki wewnętrzne. Tekst przypominający HTML zostaje
 * tekstem, a strona dokumentu nieopublikowanego nadal odpowiada 404 (test
 * `__tests__/app/legal-pages.test.tsx`).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LegalContent } from "@/components/legal/legal-content";
import { LEGAL_CONTENT } from "@/lib/legal/content";
import { parseLegalMarkdown } from "@/lib/legal/markdown";

function renderMarkdown(source: string) {
  return render(<LegalContent blocks={parseLegalMarkdown(source)} />);
}

describe("LegalContent", () => {
  it("nagłówki, pogrubienie i odnośnik wewnętrzny", () => {
    renderMarkdown("## 1. Kto\n\nZobacz **[umowę](/dpa)**.");
    expect(screen.getByRole("heading", { level: 2, name: "1. Kto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "umowę" })).toHaveAttribute("href", "/dpa");
  });

  it("lista numerowana zachowuje numery z treści", () => {
    const { container } = renderMarkdown("1. a\n   4. b");
    const values = Array.from(container.querySelectorAll("li")).map((li) => li.getAttribute("value"));
    expect(values).toEqual(["1", "4"]);
  });

  it("tabela z nagłówkiem i wierszami", () => {
    renderMarkdown("| Firma | Po co |\n|---|---|\n| Dostawca | serwery |");
    expect(screen.getByRole("columnheader", { name: "Firma" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "serwery" })).toBeInTheDocument();
  });

  it("tekst przypominający HTML nie tworzy elementów", () => {
    const { container } = renderMarkdown('<img src=x onerror="alert(1)"> [x](https://example.com)');
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("treść regulaminu: odnośniki tylko do stron serwisu", () => {
    renderMarkdown(LEGAL_CONTENT.terms);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^\/[a-z]/);
  });
});

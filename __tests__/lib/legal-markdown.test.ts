/**
 * Parser treści dokumentów prawnych: nagłówki, akapity, listy (także
 * zagnieżdżone z numerami z treści), tabele, linia pozioma oraz pogrubienie,
 * kod i odnośniki. Odnośnik powstaje tylko dla adresu wewnątrz serwisu.
 */
import { describe, it, expect } from "vitest";
import { LEGAL_CONTENT } from "@/lib/legal/content";
import { LEGAL_DOCUMENT_KEYS } from "@/lib/legal/documents";
import { parseLegalInline, parseLegalMarkdown } from "@/lib/legal/markdown";

const text = (value: string) => ({ type: "text", text: value });

describe("parseLegalInline", () => {
  it("zwykły tekst bez zmian", () => {
    expect(parseLegalInline("Zwykły tekst.")).toEqual([text("Zwykły tekst.")]);
  });

  it("pogrubienie, kod i odnośnik wewnętrzny", () => {
    expect(parseLegalInline("a **b** `c` [d](/dpa) e")).toEqual([
      text("a "),
      { type: "strong", children: [text("b")] },
      text(" "),
      { type: "code", text: "c" },
      text(" "),
      { type: "link", href: "/dpa", children: [text("d")] },
      text(" e"),
    ]);
  });

  it("odnośnik wewnątrz pogrubienia", () => {
    expect(parseLegalInline("**zob. [Regulamin](/terms)**")).toEqual([
      {
        type: "strong",
        children: [text("zob. "), { type: "link", href: "/terms", children: [text("Regulamin")] }],
      },
    ]);
  });

  it("adres zewnętrzny, protokołowy albo nie-adres zostaje tekstem", () => {
    for (const source of [
      "[x](https://example.com)",
      "[x](//example.com)",
      "[x](javascript:alert(1))",
      "[konto salonu / konto klienta](*)",
    ]) {
      const nodes = parseLegalInline(source);
      expect(nodes.every((node) => node.type === "text"), source).toBe(true);
      expect(nodes.map((node) => (node.type === "text" ? node.text : "")).join("")).toBe(source);
    }
  });

  it("znacznik do uzupełnienia zostaje tekstem", () => {
    expect(parseLegalInline("Google Cloud ([DO UZUPEŁNIENIA: podmiot])")).toEqual([
      text("Google Cloud ([DO UZUPEŁNIENIA: podmiot])"),
    ]);
  });

  it("znaczniki HTML są zwykłym tekstem", () => {
    expect(parseLegalInline("<script>alert(1)</script>")).toEqual([
      text("<script>alert(1)</script>"),
    ]);
  });
});

describe("parseLegalMarkdown", () => {
  it("pusta treść: brak bloków", () => {
    expect(parseLegalMarkdown("")).toEqual([]);
    expect(parseLegalMarkdown("\n\n  \n")).toEqual([]);
  });

  it("nagłówki, akapit z łamaniem wiersza i linia pozioma", () => {
    expect(parseLegalMarkdown("## A\n\n### B\n\nwiersz 1\nwiersz 2\n\n---")).toEqual([
      { type: "heading", level: 2, content: [text("A")] },
      { type: "heading", level: 3, content: [text("B")] },
      { type: "paragraph", content: [text("wiersz 1"), { type: "break" }, text("wiersz 2")] },
      { type: "rule" },
    ]);
  });

  it("akapit, po nim od razu lista punktowana", () => {
    expect(parseLegalMarkdown("Dotyczy to:\n- a,\n- b.")).toEqual([
      { type: "paragraph", content: [text("Dotyczy to:")] },
      {
        type: "list",
        ordered: false,
        items: [
          { value: null, content: [text("a,")], children: null },
          { value: null, content: [text("b.")], children: null },
        ],
      },
    ]);
  });

  it("lista numerowana z zagnieżdżeniem zachowuje numery z treści", () => {
    const blocks = parseLegalMarkdown("1. pierwszy\n2. drugi\n   1. pod\n   4. pod cztery\n3. trzeci");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          { value: 1, content: [text("pierwszy")], children: null },
          {
            value: 2,
            content: [text("drugi")],
            children: {
              type: "list",
              ordered: true,
              items: [
                { value: 1, content: [text("pod")], children: null },
                { value: 4, content: [text("pod cztery")], children: null },
              ],
            },
          },
          { value: 3, content: [text("trzeci")], children: null },
        ],
      },
    ]);
  });

  it("zmiana rodzaju listy zaczyna nową listę", () => {
    const blocks = parseLegalMarkdown("1. a\n- b");
    expect(blocks.map((block) => block.type === "list" && block.ordered)).toEqual([true, false]);
  });

  it("tabela: nagłówek, bez wiersza separatora, komórki z formatowaniem", () => {
    expect(parseLegalMarkdown("| A | B |\n|---|---|\n| **x** | [y](/privacy) |")).toEqual([
      {
        type: "table",
        header: [[text("A")], [text("B")]],
        rows: [
          [
            [{ type: "strong", children: [text("x")] }],
            [{ type: "link", href: "/privacy", children: [text("y")] }],
          ],
        ],
      },
    ]);
  });

  it("treść każdego dokumentu daje bloki, a znaczniki zostają w tekście", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      const blocks = parseLegalMarkdown(LEGAL_CONTENT[key]);
      expect(blocks.length, key).toBeGreaterThan(0);
      expect(JSON.stringify(blocks), key).toContain("[DO UZUPEŁNIENIA");
    }
  });

  it("w treści dokumentów nie ma znaczników HTML", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(LEGAL_CONTENT[key], key).not.toMatch(/<[a-z/!]/i);
    }
  });
});

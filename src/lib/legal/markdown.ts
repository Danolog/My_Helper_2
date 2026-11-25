/**
 * Minimalny parser markdownu dla treści dokumentów prawnych.
 *
 * Obsługuje tylko to, czego używają dokumenty: nagłówki `##` i `###`, akapity
 * (kolejne wiersze akapitu to złamania wiersza), listy punktowane i numerowane
 * (z jednym poziomem zagnieżdżenia), tabele, linię poziomą oraz w tekście
 * pogrubienie, kod i odnośniki. Wynik to struktura danych, a nie HTML: strona
 * renderuje ją jako elementy React, więc żaden fragment treści nie trafia do
 * przeglądarki jako surowy HTML.
 *
 * Odnośnik powstaje tylko dla adresu wewnątrz serwisu (zaczyna się od jednego
 * `/`). Każda inna składnia odnośnika zostaje zwykłym tekstem — także wzór
 * w formularzu odstąpienia `[konto salonu / konto klienta](*)`.
 */

export type LegalInline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "strong"; readonly children: readonly LegalInline[] }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "link"; readonly href: string; readonly children: readonly LegalInline[] }
  | { readonly type: "break" };

export type LegalListItem = {
  /** Numer z treści dla listy numerowanej (np. 4 w „4. …”), `null` dla punktów. */
  readonly value: number | null;
  readonly content: readonly LegalInline[];
  readonly children: LegalList | null;
};

export type LegalList = {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly LegalListItem[];
};

export type LegalTableRow = readonly (readonly LegalInline[])[];

export type LegalBlock =
  | { readonly type: "heading"; readonly level: 2 | 3; readonly content: readonly LegalInline[] }
  | { readonly type: "paragraph"; readonly content: readonly LegalInline[] }
  | LegalList
  | { readonly type: "table"; readonly header: LegalTableRow; readonly rows: readonly LegalTableRow[] }
  | { readonly type: "rule" };

// Wiersz listy: wcięcie, znacznik („-” albo „N.”) i treść.
const LIST_ITEM = /^(\s*)(?:(\d+)\.|-)\s+(.*)$/;
const HEADING = /^(#{2,3})\s+(.*)$/;
const RULE = /^-{3,}$/;
// Wiersz oddzielający nagłówek tabeli od wierszy, np. `|---|:---:|`.
const TABLE_SEPARATOR = /^\|[\s|:-]+\|$/;
// Kod, pogrubienie albo odnośnik — pierwszy pasujący od lewej.
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^[\]]+)\]\(([^()\s]+)\)/g;

/** Czy adres prowadzi do strony w serwisie (nie `//host`, nie inny schemat). */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function parseLegalInline(source: string): LegalInline[] {
  const result: LegalInline[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text !== "") result.push({ type: "text", text });
  };

  for (const match of source.matchAll(INLINE)) {
    const [whole, code, strong, linkText, href] = match;
    const start = match.index;
    pushText(source.slice(last, start));
    if (code !== undefined) {
      result.push({ type: "code", text: code });
    } else if (strong !== undefined) {
      result.push({ type: "strong", children: parseLegalInline(strong) });
    } else if (linkText !== undefined && href !== undefined && isInternalHref(href)) {
      result.push({ type: "link", href, children: parseLegalInline(linkText) });
    } else {
      pushText(whole);
    }
    last = start + whole.length;
  }
  pushText(source.slice(last));
  return result;
}

function parseTableRow(line: string): LegalInline[][] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseLegalInline(cell.trim()));
}

function parseTable(lines: readonly string[]): LegalBlock {
  const [headerLine = "", ...rest] = lines;
  const rowLines =
    rest[0] !== undefined && TABLE_SEPARATOR.test(rest[0]) ? rest.slice(1) : rest;
  return { type: "table", header: parseTableRow(headerLine), rows: rowLines.map(parseTableRow) };
}

function parseParagraph(lines: readonly string[]): LegalBlock {
  const content: LegalInline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: "break" });
    content.push(...parseLegalInline(line));
  });
  return { type: "paragraph", content };
}

type MutableItem = { value: number | null; content: LegalInline[]; children: MutableList | null };
type MutableList = { type: "list"; ordered: boolean; items: MutableItem[] };

/** Blok, który jeszcze zbiera kolejne wiersze. */
type OpenBlock =
  | { kind: "none" }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "table"; lines: string[] }
  | { kind: "list"; list: MutableList };

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let open: OpenBlock = { kind: "none" };

  const close = () => {
    if (open.kind === "paragraph") blocks.push(parseParagraph(open.lines));
    if (open.kind === "table") blocks.push(parseTable(open.lines));
    if (open.kind === "list") blocks.push(open.list);
    open = { kind: "none" };
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      close();
      continue;
    }

    if (trimmed.startsWith("|")) {
      if (open.kind !== "table") {
        close();
        open = { kind: "table", lines: [] };
      }
      open.lines.push(trimmed);
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      close();
      blocks.push({
        type: "heading",
        level: heading[1] === "##" ? 2 : 3,
        content: parseLegalInline(heading[2] ?? ""),
      });
      continue;
    }

    if (RULE.test(trimmed)) {
      close();
      blocks.push({ type: "rule" });
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem !== null) {
      const indent = listItem[1] ?? "";
      const number = listItem[2];
      const ordered = number !== undefined;
      const item: MutableItem = {
        value: ordered ? Number(number) : null,
        content: parseLegalInline(listItem[3] ?? ""),
        children: null,
      };

      if (indent.length > 0 && open.kind === "list") {
        // Wiersz z wcięciem należy do ostatniego punktu listy nadrzędnej.
        const parent = open.list.items[open.list.items.length - 1];
        if (parent !== undefined) {
          if (parent.children === null || parent.children.ordered !== ordered) {
            parent.children = { type: "list", ordered, items: [] };
          }
          parent.children.items.push(item);
          continue;
        }
      }

      if (open.kind !== "list" || open.list.ordered !== ordered) {
        close();
        open = { kind: "list", list: { type: "list", ordered, items: [] } };
      }
      open.list.items.push(item);
      continue;
    }

    if (open.kind !== "paragraph") {
      close();
      open = { kind: "paragraph", lines: [] };
    }
    open.lines.push(trimmed);
  }

  close();
  return blocks;
}

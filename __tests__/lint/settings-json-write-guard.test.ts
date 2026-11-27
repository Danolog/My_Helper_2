// @vitest-environment node
// Strażnik zapisu `salons.settingsJson` (kolumna `settings_json`).
//
// Ustawienia salonu trzymają kilka niezależnych kluczy, w tym numer BLIK
// właściciela i datę jego zgody (`deposits`). Zapis CAŁEGO obiektu ustawień
// ze starej kopii (odczyt → scalenie w JS → zapis) przywróciłby po cichu numer,
// który właściciel właśnie wycofał równoległym żądaniem. Dlatego każdy zapis
// tej kolumny musi podmieniać jeden klucz wyrażeniem `jsonb_set(...)`.
//
// Skan tekstu wszystkich plików `.ts` i `.tsx` w `src` (z podkatalogami).
// Za zapis kolumny uznawane są:
//   1. klucz `settingsJson:` albo skrót `{ settingsJson }` w obiekcie przekazanym do `.set({ ... })` (UPDATE drizzle),
//   2. surowy SQL `settings_json = ...` (UPDATE ... SET),
//   3. klucz `settingsJson:` albo skrót w `.insert(salons).values({ ... })` (INSERT drizzle).
// Wartość każdego zapisu musi zaczynać się od `sql\`jsonb_set(` (1, 3) albo
// `jsonb_set(` (2). Dozwolone wyjątki: ALLOWED_EXCEPTIONS (dziś pusta).
//
// Ograniczenia skanu tekstowego (zapis niewidoczny): obiekt zbudowany wcześniej
// i przekazany jako `.set(zmienna)`, kolumna wstawiona do szablonu `sql` jako
// `${salons.settingsJson} = …`, insert tabeli pod inną nazwą niż `salons`. Asercja
// dokładnej listy (EXPECTED_WRITES) łapie zniknięcie dzisiejszego zapisu z widoku
// skanu, ale nie nowy zapis w niewidocznej formie.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

/** Zapisy `settingsJson` w `src` znane dziś (plik → liczba zapisów jsonb_set). */
const EXPECTED_WRITES: Record<string, number> = {
  "src/app/api/salon/blik-deposit/route.ts": 1,
  "src/app/api/salons/[id]/birthday-settings/route.ts": 1,
  "src/app/api/salons/[id]/loyalty-settings/route.ts": 1,
  "src/app/api/salons/[id]/modules/route.ts": 1,
  "src/app/api/salons/[id]/no-show-settings/route.ts": 1,
  "src/app/api/salons/[id]/notification-type-settings/route.ts": 1,
  "src/app/api/salons/[id]/we-miss-you-settings/route.ts": 1,
};

/**
 * Zapisy poza jsonb_set dopuszczone świadomie: `plik:linia` → uzasadnienie.
 * Pusta: żaden insert salonu nie ustawia `settingsJson` (nowy salon dostaje domyślne
 * `'{}'::jsonb`, a SQL NULL trasy ustawień obsługują przez `coalesce`).
 */
const ALLOWED_EXCEPTIONS: Record<string, string> = {};

const EXPECTED_TOTAL = 7;

interface Write {
  file: string;
  line: number;
  kind: "set" | "raw-sql" | "insert";
  /** Początek wartości zapisu (do komunikatu błędu). */
  value: string;
  atomic: boolean;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/**
 * Indeks nawiasu zamykającego dla otwierającego `open` na pozycji `start`.
 * Liczy tylko głębokość nawiasów; w kodzie tras ustawień nawiasy w napisach
 * i szablonach są zbalansowane, więc to wystarcza. -1, gdy brak domknięcia.
 */
function matchingClose(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Klucze `settingsJson` (z dwukropkiem albo skrótem) w fragmencie `body` zaczynającym się na pozycji `offset` pliku. */
function settingsKeysIn(file: string, text: string, body: string, offset: number, kind: Write["kind"]): Write[] {
  const found: Write[] = [];
  for (const m of body.matchAll(/(?<![.\w$])settingsJson(?:\s*:\s*|(?=\s*[,}]))/g)) {
    const valueStart = m.index! + m[0].length;
    const value = body.slice(valueStart, valueStart + 60);
    found.push({
      file,
      line: lineAt(text, offset + m.index!),
      kind,
      value: value.split("\n")[0]!,
      atomic: value.startsWith("sql`jsonb_set("),
    });
  }
  return found;
}

/** Wszystkie zapisy kolumny w jednym pliku. */
function findSettingsWrites(file: string, text: string): Write[] {
  const writes: Write[] = [];

  // 1. UPDATE drizzle: `.set( ... )` — cały argument (obiekt) do nawiasu zamykającego.
  for (const m of text.matchAll(/\.set\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(text, open, "(", ")");
    if (close < 0) continue;
    writes.push(...settingsKeysIn(file, text, text.slice(open, close + 1), open, "set"));
  }

  // 3. INSERT drizzle: `.insert(salons)` … `.values( ... )`.
  for (const m of text.matchAll(/\.insert\(\s*salons\s*\)\s*\.values\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(text, open, "(", ")");
    if (close < 0) continue;
    writes.push(...settingsKeysIn(file, text, text.slice(open, close + 1), open, "insert"));
  }

  // 2. Surowy SQL: `settings_json = ...` (bez `==`), także z nazwą w cudzysłowie.
  for (const m of text.matchAll(/\bsettings_json"?\s*=(?!=)\s*/g)) {
    const valueStart = m.index! + m[0].length;
    const value = text.slice(valueStart, valueStart + 60);
    writes.push({
      file,
      line: lineAt(text, m.index!),
      kind: "raw-sql",
      value: value.split("\n")[0]!,
      atomic: /^jsonb_set\(/i.test(value),
    });
  }

  return writes;
}

const writes: Write[] = walk(path.join(ROOT, "src")).flatMap((abs) =>
  findSettingsWrites(path.relative(ROOT, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"))
);

describe("zapis salons.settingsJson tylko przez jsonb_set", () => {
  it(`skan src znajduje dokładnie ${EXPECTED_TOTAL} zapisów, zgodnie z listą oczekiwaną`, () => {
    // Liczba chroni przed cichym „0 trafień” (np. po zmianie zapisu, której skan nie widzi).
    const perFile: Record<string, number> = {};
    for (const w of writes) perFile[w.file] = (perFile[w.file] ?? 0) + 1;
    expect(perFile).toEqual(EXPECTED_WRITES);
    expect(writes).toHaveLength(EXPECTED_TOTAL);
  });

  it("każdy zapis jest wyrażeniem jsonb_set (poza wyjątkami z uzasadnieniem)", () => {
    const violations = writes
      .filter((w) => !w.atomic && !(`${w.file}:${w.line}` in ALLOWED_EXCEPTIONS))
      .map((w) => `${w.file}:${w.line} (${w.kind}) settingsJson = ${w.value}`);
    expect(violations, "zapis settingsJson bez jsonb_set — podmień jeden klucz przez jsonb_set").toEqual([]);
  });

  it("wyjątki wskazują istniejące zapisy (lista nie gnije)", () => {
    const present = new Set(writes.map((w) => `${w.file}:${w.line}`));
    expect(Object.keys(ALLOWED_EXCEPTIONS).filter((k) => !present.has(k))).toEqual([]);
  });
});

describe("findSettingsWrites — rozpoznawanie wzorców", () => {
  it("zapis całego obiektu w .set() → nieatomowy z numerem linii", () => {
    const src = "await tx\n  .update(salons)\n  .set({ settingsJson: { ...old, loyalty } })\n";
    expect(findSettingsWrites("x.ts", src)).toEqual([
      expect.objectContaining({ file: "x.ts", line: 3, kind: "set", atomic: false }),
    ]);
  });

  it("skrót { settingsJson } w .set() → nieatomowy", () => {
    expect(findSettingsWrites("x.ts", "tx.update(salons).set({ name, settingsJson })")).toEqual([
      expect.objectContaining({ line: 1, kind: "set", atomic: false }),
    ]);
  });

  it("jsonb_set w .set() → atomowy", () => {
    const src = ".set({ settingsJson: sql`jsonb_set(coalesce(${salons.settingsJson}, '{}'::jsonb), '{x}', ${v}::jsonb)` })";
    expect(findSettingsWrites("x.ts", src)).toEqual([expect.objectContaining({ kind: "set", atomic: true })]);
  });

  it("surowy SQL: settings_json = $1 → nieatomowy; settings_json = jsonb_set(…) → atomowy; == pomijane", () => {
    const bad = findSettingsWrites("x.ts", 'sql`UPDATE salons SET settings_json = ${v}::jsonb`');
    const good = findSettingsWrites("x.ts", "sql`UPDATE salons SET \"settings_json\" = jsonb_set(settings_json, '{a}', ${v})`");
    expect(bad).toEqual([expect.objectContaining({ kind: "raw-sql", atomic: false })]);
    expect(good).toEqual([expect.objectContaining({ kind: "raw-sql", atomic: true })]);
    expect(findSettingsWrites("x.ts", "if (a.settings_json == b) {}")).toEqual([]);
  });

  it("insert salonu z settingsJson → wykryty; odczyt w select() → pomijany", () => {
    const insert = findSettingsWrites("x.ts", "db.insert(salons).values({ name, settingsJson: {} })");
    expect(insert).toEqual([expect.objectContaining({ kind: "insert", atomic: false })]);
    const read = findSettingsWrites("x.ts", "tx.select({ settingsJson: salons.settingsJson }).from(salons)");
    expect(read).toEqual([]);
  });
});

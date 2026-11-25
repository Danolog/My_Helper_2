// @vitest-environment node
/**
 * Niezmiennik bramki panelu: layout `src/app/dashboard/layout.tsx` przy
 * `allowed: false` nie renderuje `children`, ale nie przerywa odpowiedzi
 * (`redirect`). Next.js renderuje segment podstrony niezależnie od layoutu
 * i jej wynik serwerowy i tak trafia do payloadu RSC. Dlatego każdy plik
 * segmentu pod `/dashboard` (poza głównym layoutem) musi być kliencki albo
 * mieć własną bramkę.
 *
 * Test czyta tekst źródeł (bez renderowania) i dla każdego pliku
 * `src/app/dashboard/**\/{page,layout,template,default}.{tsx,ts,jsx,js}`
 * wymaga jednego z warunków:
 * - (a) pierwsza niepusta linia to dyrektywa `"use client"`;
 * - (b) plik woła własną bramkę: `requireDashboardAccess` ze sprawdzeniem
 *   `allowed` albo `getSalonContext` z `notFound`/`redirect` przy `null`.
 *
 * Dodatkowo `generateMetadata` (w dowolnym pliku `src/app/dashboard`) i pliki
 * w slotach `@*` muszą spełniać (b): dyrektywa klienta ich nie chroni.
 *
 * Czego NIE sprawdza: czy bramka w (b) jest wywołana przed odczytem danych
 * i czy jej wynik naprawdę przerywa renderowanie — to zostaje do recenzji.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DASHBOARD_DIR = "src/app/dashboard";
/** Główny layout ma własną bramkę i to on renderuje prompt zakładania salonu. */
const ROOT_LAYOUT = `${DASHBOARD_DIR}/layout.tsx`;
const SEGMENT_FILE = /^(page|layout|template|default)\.(tsx|ts|jsx|js)$/;
const SOURCE_FILE = /\.(tsx|ts|jsx|js)$/;
const GUARD_MESSAGE =
  "serwerowa podstrona panelu bez własnej bramki: layout nie chroni jej payloadu";

/** Wszystkie pliki pod katalogiem, ścieżki względne od korzenia repo, z `/`. */
function listFiles(dir: string): string[] {
  const entries = fs.readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")
    )
    .sort();
}

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/** (a) Pierwsza niepusta linia to `"use client"` / `'use client'` (średnik opcjonalny). */
function isClientModule(source: string): boolean {
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() !== "");
  return firstLine !== undefined && /^\s*(["'])use client\1;?\s*$/.test(firstLine);
}

/**
 * (b) Plik woła własną bramkę. Sprawdzenie tekstowe: wywołanie bramki razem
 * z odczytem jej wyniku (`allowed` albo gałąź `notFound`/`redirect` przy
 * pustym kontekście). Komentarze nie liczą się jako wywołanie.
 */
function hasOwnGate(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const dashboardAccess = /\brequireDashboardAccess\s*\(/.test(code) && /\ballowed\b/.test(code);
  const salonContext =
    /\bgetSalonContext\s*\(/.test(code) &&
    /(!\s*\w+|\w+\s*===?\s*null)\s*\)?\s*(\{\s*)?(return\s+)?(notFound|redirect)\s*\(/.test(code);
  return dashboardAccess || salonContext;
}

function isInSlot(file: string): boolean {
  return file.split("/").some((segment) => segment.startsWith("@"));
}

const allFiles = listFiles(DASHBOARD_DIR);
const segmentFiles = allFiles.filter(
  (file) => SEGMENT_FILE.test(path.posix.basename(file)) && file !== ROOT_LAYOUT
);

describe("predykaty strażnika (kontrola fałszywej zieleni)", () => {
  it("strona serwerowa bez bramki nie spełnia ani (a), ani (b)", () => {
    const source = 'import { db } from "@/lib/db";\nexport default async function Page() {}\n';
    expect(isClientModule(source)).toBe(false);
    expect(hasOwnGate(source)).toBe(false);
  });

  it('"use client" w pierwszej niepustej linii spełnia (a), także po pustych liniach', () => {
    expect(isClientModule('\n\n"use client";\nexport default function Page() {}\n')).toBe(true);
    expect(isClientModule("'use client'\n")).toBe(true);
  });

  it('"use client" nie w pierwszej niepustej linii nie spełnia (a)', () => {
    expect(isClientModule('import x from "x";\n"use client";\n')).toBe(false);
  });

  it("requireDashboardAccess z allowed spełnia (b), samo wywołanie bez allowed nie", () => {
    expect(
      hasOwnGate("const { allowed } = await requireDashboardAccess();\nif (!allowed) notFound();\n")
    ).toBe(true);
    expect(hasOwnGate("await requireDashboardAccess();\n")).toBe(false);
  });

  it("getSalonContext z notFound/redirect przy null spełnia (b), bez tej gałęzi nie", () => {
    expect(hasOwnGate("const ctx = await getSalonContext();\nif (!ctx) notFound();\n")).toBe(true);
    expect(
      hasOwnGate('const ctx = await getSalonContext();\nif (ctx === null) {\n  redirect("/");\n}\n')
    ).toBe(true);
    expect(hasOwnGate("const ctx = await getSalonContext();\nreturn ctx?.salonId;\n")).toBe(false);
  });

  it("bramka tylko w komentarzu nie spełnia (b)", () => {
    expect(
      hasOwnGate("// const { allowed } = await requireDashboardAccess();\nexport default 1;\n")
    ).toBe(false);
  });
});

describe(`strażnik podstron ${DASHBOARD_DIR}`, () => {
  it("drzewo panelu ma pliki segmentów do sprawdzenia, a główny layout ma własną bramkę", () => {
    expect(segmentFiles.length).toBeGreaterThan(0);
    expect(hasOwnGate(read(ROOT_LAYOUT))).toBe(true);
  });

  it("każdy page/layout/template/default jest kliencki albo ma własną bramkę", () => {
    const offenders = segmentFiles.filter((file) => {
      const source = read(file);
      return !isClientModule(source) && !hasOwnGate(source);
    });
    expect(offenders, GUARD_MESSAGE).toEqual([]);
  });

  it("pliki w slotach @* mają własną bramkę", () => {
    const offenders = allFiles
      .filter((file) => isInSlot(file) && SOURCE_FILE.test(file))
      .filter((file) => !hasOwnGate(read(file)));
    expect(offenders, GUARD_MESSAGE).toEqual([]);
  });

  it("generateMetadata występuje tylko w plikach z własną bramką", () => {
    const offenders = allFiles
      .filter((file) => SOURCE_FILE.test(file))
      .filter((file) => {
        const source = read(file);
        return /\bgenerateMetadata\b/.test(source) && !hasOwnGate(source);
      });
    expect(offenders, GUARD_MESSAGE).toEqual([]);
  });
});

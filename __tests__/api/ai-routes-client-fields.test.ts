/**
 * Pola osób w plikach tras AI (statyczny odczyt źródeł, bez uruchamiania tras).
 *
 * 1. Żaden plik pod src/app/api/ai/** nie odwołuje się do alergii klienta.
 * 2. Odwołania do nazwiska (`lastName`) są dozwolone tylko w plikach z jawnej
 *    listy poniżej, każdy wpis z powodem.
 * 3. Wpis listy, którego plik nie istnieje, nie ma już odwołania do nazwiska
 *    albo przestał spełniać opisany warunek (woła / nie woła modelu),
 *    czerwieni test — lista się nie starzeje.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();
const AI_DIR = join(ROOT, "src", "app", "api", "ai");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(m|c)?[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Kod bez komentarzy — wzmianka w komentarzu nie jest odwołaniem do pola. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Wywołanie albo import modelu (ten sam wzorzec co w strażniku bramki tras AI). */
const MODEL_CALL =
  /\b(generateText|streamText|generateObject|streamObject|generateImage|streamBusinessChat|createAIClient|createOpenRouter|getChatModel)\s*\(|\bfrom\s*["'`](ai|@openrouter\/ai-sdk-provider|@google\/genai|@ai-sdk\/[^"'`]+)["'`]/;
const ALLERGIES = /allerg(y|ies)/i;
const LAST_NAME = /last_?name/i;

type SourceFile = { path: string; code: string };

const FILES: SourceFile[] = sourceFiles(AI_DIR).map((file) => ({
  path: relative(ROOT, file).split(sep).join("/"),
  code: codeOnly(readFileSync(file, "utf8")),
}));

type LastNameException = {
  /** Jedno zdanie: dlaczego nazwisko jest w tym pliku. */
  reason: string;
  /** Czy plik woła model — część powodu, sprawdzana przy każdym przebiegu. */
  callsModel: boolean;
};

const LAST_NAME_EXCEPTIONS: Record<string, LastNameException> = {
  "src/app/api/ai/business/analytics/route.ts": {
    reason:
      "Trasa nie woła modelu; imię i nazwisko pracownika trafiają tylko do zestawienia w odpowiedzi dla panelu salonu.",
    callsModel: false,
  },
  "src/app/api/ai/business/review-alerts/route.ts": {
    reason:
      "Imię i nazwisko klienta i pracownika trafiają do odpowiedzi dla panelu salonu i do szablonu odpowiedzi budowanego na serwerze, a do modelu idzie samo pierwsze imię klienta.",
    callsModel: true,
  },
};

describe("pola osób w plikach tras AI", () => {
  it("kontrola: skaner widzi pliki tras AI (test nie jest pusty)", () => {
    expect(FILES.length).toBeGreaterThan(15);
    expect(FILES.some((f) => MODEL_CALL.test(f.code))).toBe(true);
  });

  it("żaden plik tras AI nie odwołuje się do alergii", () => {
    const hits = FILES.filter((f) => ALLERGIES.test(f.code)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("nazwisko tylko w plikach z listy wyjątków", () => {
    const hits = FILES.filter(
      (f) => LAST_NAME.test(f.code) && !(f.path in LAST_NAME_EXCEPTIONS),
    ).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  describe("lista wyjątków jest aktualna", () => {
    const byPath = new Map(FILES.map((f) => [f.path, f]));

    it.each(Object.keys(LAST_NAME_EXCEPTIONS))(
      "%s istnieje, nadal odwołuje się do nazwiska i spełnia opisany warunek",
      (path) => {
        const file = byPath.get(path);
        expect(file, path).toBeDefined();
        expect(LAST_NAME.test(file!.code), "brak odwołania do nazwiska — usuń wpis z listy").toBe(
          true,
        );
        expect(MODEL_CALL.test(file!.code), "zmienił się warunek z powodu wpisu").toBe(
          LAST_NAME_EXCEPTIONS[path]!.callsModel,
        );
      },
    );

    it("każdy wpis ma powód w jednym zdaniu", () => {
      for (const { reason } of Object.values(LAST_NAME_EXCEPTIONS)) {
        expect(reason.trim().length).toBeGreaterThan(20);
        expect(reason.trim()).toMatch(/\.$/);
        expect(reason.trim().slice(0, -1)).not.toMatch(/\.\s/);
      }
    });
  });

  it("kontrola: reguły łapią warianty zapisu, a komentarz nie jest odwołaniem", () => {
    for (const sample of [
      "allergies: clients.allergies,",
      "const clientAllergies = row.allergies;",
      "SELECT allergy FROM x",
    ]) {
      expect(ALLERGIES.test(sample), sample).toBe(true);
    }
    for (const sample of [
      "lastName: employees.lastName,",
      "employeeLastName: employees.lastName,",
      "sql`last_name`",
    ]) {
      expect(LAST_NAME.test(sample), sample).toBe(true);
    }
    expect(LAST_NAME.test(codeOnly("// employees.lastName\nconst x = 1;"))).toBe(false);
    expect(ALLERGIES.test(codeOnly("/* clients.allergies */"))).toBe(false);
  });
});

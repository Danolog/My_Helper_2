/**
 * Strażnik statyczny (hotfix P1, dane osobowe w logach): żadne wywołanie
 * `logger.*` ani `console.*` w `src` nie loguje całego obiektu zmian
 * (`updateData`), treści żądania (`body`) ani zwalidowanego wejścia
 * (`validated`, `validatedData`, `validatedBody`, …) — ani jako kontekstu
 * (`{ updateData }`, `{ data: updateData }`, `{ ...updateData }`), ani
 * w tekście komunikatu (`${body}`). Dozwolone: `Object.keys(updateData)`
 * i `body.length`. Siatka w `src/lib/logger.ts` redaguje klucze osobowe, ale
 * nie zgadnie, że `data` to wolny tekst o kliencie — stąd zakaz u źródła.
 *
 * Skanuje .ts/.tsx/.js/.jsx/.mjs/.cjs (Ryan: luka „tylko .ts” z G6).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

const CALL_START = /\b(?:logger|console)\.(?:log|info|warn|error|debug|trace)\s*\(/g;

/** Pełny tekst wywołania od nazwy do domykającego nawiasu. */
function extractCalls(text: string): Array<{ line: number; call: string }> {
  const calls: Array<{ line: number; call: string }> = [];
  for (const m of text.matchAll(CALL_START)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    while (i < text.length && depth > 0) {
      const c = text[i]!;
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    calls.push({ line: text.slice(0, m.index).split("\n").length, call: text.slice(m.index, i) });
  }
  return calls;
}

/**
 * Kod wywołania bez treści napisów: '…' i "…" znikają, z szablonów `…`
 * zostają tylko wyrażenia `${…}` — tam nazwa zmiennej jest kodem.
 */
function codeOnly(call: string): string {
  let out = "";
  let i = 0;
  while (i < call.length) {
    const c = call[i]!;
    if (c === '"' || c === "'") {
      i++;
      while (i < call.length && call[i] !== c) i += call[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else if (c === "`") {
      i++;
      while (i < call.length && call[i] !== "`") {
        if (call[i] === "\\") i += 2;
        else if (call[i] === "$" && call[i + 1] === "{") {
          let depth = 1;
          let j = i + 2;
          while (j < call.length && depth > 0) {
            if (call[j] === "{") depth++;
            else if (call[j] === "}") depth--;
            j++;
          }
          out += ` ${call.slice(i + 2, j - 1)} `;
          i = j;
        } else i++;
      }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Zakazane nazwy (jako identyfikator, klucz albo przez spread). */
const FORBIDDEN = /\b(updateData|body|validated(?:[A-Z]\w*)?)\b/g;
/** Dozwolone użycia: lista nazw pól i długość. */
const ALLOWED_USES = /Object\.keys\(\s*(?:updateData|body|validated\w*)\s*\)|\b(?:body|validated\w*)\.length\b/g;

function forbiddenInCall(call: string): string[] {
  const code = codeOnly(call).replace(ALLOWED_USES, "");
  return [...code.matchAll(FORBIDDEN)]
    .map((m) => m[1]!)
    // Identyfikatory (…Id / …Ids) zwalidowanego wejścia to nie dane osobowe.
    .filter((name) => !/(Id|Ids)$/.test(name));
}

const FILES = sourceFiles(join(ROOT, "src")).map((file) => ({
  path: relative(ROOT, file),
  text: readFileSync(file, "utf8"),
}));

describe("strażnik: logi nie dostają całego updateData / body / validated*", () => {
  it("kontrola: skaner widzi src i wywołania loggera (test nie jest pusty)", () => {
    expect(FILES.length).toBeGreaterThan(500);
    const calls = FILES.flatMap((f) => extractCalls(f.text));
    expect(calls.length).toBeGreaterThan(400);
  });

  it("żadne wywołanie logger.* / console.* w src nie loguje tych obiektów", () => {
    const hits = FILES.flatMap((f) =>
      extractCalls(f.text)
        .map(({ line, call }) => ({ at: `${f.path}:${line}`, names: forbiddenInCall(call) }))
        .filter((h) => h.names.length > 0)
        .map((h) => `${h.at} → ${h.names.join(", ")}`)
    );
    expect(hits).toEqual([]);
  });

  it("kontrola: wzorzec łapie każdą formę (skrót, inny klucz, spread, tekst, validated*)", () => {
    const bad = [
      "logger.info(`Updating ${id}`, { updateData });",
      "logger.info(\"x\", { data: updateData });",
      "logger.info(\"x\", { ...updateData });",
      "logger.warn(`Body: ${JSON.stringify(body)}`);",
      "logger.info(\"x\", { payload: validatedData });",
      "logger.debug(\"x\", { input: validated });",
      "console.log(\"x\", body);",
      "logger.info(\"x\", { ...validatedBody, salonId });",
    ];
    for (const sample of bad) {
      const call = extractCalls(sample)[0]!.call;
      expect(forbiddenInCall(call), sample).not.toEqual([]);
    }
  });

  it("kontrola: dozwolone użycia nie są zgłaszane", () => {
    const ok = [
      "logger.info(`Updating ${id}`, { fields: Object.keys(updateData) });",
      "logger.warn(\"invalid request body\", { size: body.length });",
      "logger.info(`Promo ${validatedPromoCodeId}`);",
      "logger.info('updateData body validated');",
    ];
    for (const sample of ok) {
      const call = extractCalls(sample)[0]!.call;
      expect(forbiddenInCall(call), sample).toEqual([]);
    }
  });
});

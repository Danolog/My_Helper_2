// @vitest-environment node
/**
 * Strażnik G-C4 (brief C §6–7): `infra/gcp/env-manifest.json` jest jedynym
 * pełnym spisem zmiennych środowiskowych.
 *  - każda zmienna czytana w `src` (i `next.config.ts`) jest w manifeście,
 *  - każda pozycja klasy `secret`/`var` jest faktycznie czytana w `src`,
 *  - sekrety mają poprawną i unikalną nazwę w Secret Manager,
 *  - zmienne `NEXT_PUBLIC_*` (wpiekane w bundel) nie wyglądają na sekret,
 *  - `BLOB_STORE_ID` (C2b) jest zwykłą zmienną (`var`), nie sekretem.
 * Mutacja: dopisać w `src` odczyt `process.env.NOWA_ZMIENNA` → czerwony.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Entry = { class: string; secretName?: string; required?: boolean; note?: string };
const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(join(ROOT, "infra/gcp/env-manifest.json"), "utf8")) as {
  variables: Record<string, Entry>;
};
const VARS = manifest.variables;

const CLASSES = new Set([
  "secret",
  "var",
  "build",
  "image",
  "platform",
  "ci-only",
  "removed-after-b",
  "vercel-only",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Nazwy zmiennych czytanych w kodzie: `process.env.X`, `env.X` (parametr środowiska), dostęp dynamiczny. */
function usedNames(): Set<string> {
  const files = [
    ...walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f)),
    join(ROOT, "next.config.ts"),
  ];
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of [
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      /\benv\.([A-Z][A-Z0-9_]*)/g,
      // dostęp dynamiczny (usage-limits.ts: envNumber("AI_MONTHLY_…"))
      /envNumber\("([A-Z][A-Z0-9_]*)"/g,
    ]) {
      for (const m of text.matchAll(re)) names.add(m[1]!);
    }
    // twilio webhook: nazwa składana z kawałków, żeby nie wyglądała na sekret
    for (const m of text.matchAll(/\[((?:"[A-Z0-9]+",\s*)+"[A-Z0-9]+")\]\.join\("_"\)/g)) {
      names.add(JSON.parse(`[${m[1]}]`).join("_"));
    }
  }
  return names;
}

const USED = usedNames();

describe("G-C4: env-manifest.json", () => {
  it("każda zmienna czytana w src/next.config jest w manifeście", () => {
    const missing = [...USED].filter((n) => !(n in VARS)).sort();
    expect(missing).toEqual([]);
  });

  it("każda pozycja klasy secret/var jest czytana w src (bez martwych wpisów)", () => {
    const dead = Object.entries(VARS)
      .filter(([, e]) => e.class === "secret" || e.class === "var")
      .map(([n]) => n)
      .filter((n) => !USED.has(n))
      .sort();
    expect(dead).toEqual([]);
  });

  it("klasy tylko z dozwolonego zbioru", () => {
    for (const [name, e] of Object.entries(VARS)) {
      expect(CLASSES.has(e.class), `${name}: ${e.class}`).toBe(true);
    }
  });

  it("sekrety: secretName w formacie Secret Manager, unikalny; tylko sekrety mają secretName", () => {
    const seen = new Set<string>();
    for (const [name, e] of Object.entries(VARS)) {
      if (e.class === "secret") {
        expect(e.secretName, name).toMatch(/^[a-z][a-z0-9-]{0,254}$/);
        expect(seen.has(e.secretName!), `duplikat ${e.secretName}`).toBe(false);
        seen.add(e.secretName!);
      } else {
        expect(e.secretName, name).toBeUndefined();
      }
    }
  });

  it("NEXT_PUBLIC_* tylko w klasie build i bez nazwy sekretu", () => {
    for (const [name, e] of Object.entries(VARS)) {
      if (!name.startsWith("NEXT_PUBLIC_")) continue;
      expect(e.class, name).toBe("build");
      expect(name).not.toMatch(/SECRET|TOKEN|PASSWORD|PRIVATE/i);
    }
  });

  it("zmienne o nazwie sekretu są w klasie secret albo poza wdrożeniem GCP", () => {
    for (const [name, e] of Object.entries(VARS)) {
      if (!/SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(name)) continue;
      expect(["secret", "removed-after-b", "vercel-only"], name).toContain(e.class);
    }
  });

  it("C2b: BLOB_STORE_ID to zwykła zmienna (var), BLOB_READ_WRITE_TOKEN nie przechodzi na GCP", () => {
    expect(VARS.BLOB_STORE_ID?.class).toBe("var");
    expect(VARS.BLOB_READ_WRITE_TOKEN?.class).toBe("vercel-only");
  });

  it("ALLOW_PAYMENT_SIMULATION nie jest wdrażana (ci-only)", () => {
    expect(VARS.ALLOW_PAYMENT_SIMULATION?.class).toBe("ci-only");
  });

  it("STORAGE_DRIVER i GCS_BUCKET są wymagane przy wdrożeniu (wartość z vars, nie z repo)", () => {
    expect(VARS.STORAGE_DRIVER).toEqual({ class: "var", required: true });
    expect(VARS.GCS_BUCKET).toEqual({ class: "var", required: true });
  });
});

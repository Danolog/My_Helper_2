// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCsp, EMPTY_STYLE_HASH, SONNER_STYLE_HASH } from "@/proxy";

const NONCE = "testnonce0123456789abcdef";

function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    expect(map.has(name!), `zduplikowana dyrektywa ${name}`).toBe(false);
    map.set(name!, values.join(" "));
  }
  return map;
}

/** Tresc CSS, ktora sonner wstrzykuje przez __insertCSS("...") — odczyt z node_modules. */
function sonnerInjectedCss(): string {
  const source = readFileSync(
    join(process.cwd(), "node_modules", "sonner", "dist", "index.mjs"),
    "utf8",
  );
  const match = source.match(/__insertCSS\(("(?:[^"\\]|\\.)*")\)/);
  if (!match) throw new Error("Nie znaleziono wywolania __insertCSS(\"...\") w sonner/dist/index.mjs");
  return JSON.parse(match[1]!) as string;
}

function sha256(text: string): string {
  return "sha256-" + createHash("sha256").update(text, "utf8").digest("base64");
}

describe("buildCsp — produkcja", () => {
  const csp = buildCsp(NONCE);
  const d = directives(csp);

  it("hash sonnera w style-src-elem zgadza sie z trescia __insertCSS z node_modules", () => {
    const expected = sha256(sonnerInjectedCss());
    expect(SONNER_STYLE_HASH).toBe(expected);
    expect(d.get("style-src-elem")).toContain(`'${expected}'`);
  });

  it("hash pustego <style> jest poprawny i jest w style-src-elem", () => {
    expect(EMPTY_STYLE_HASH).toBe(sha256(""));
    expect(d.get("style-src-elem")).toContain(`'${EMPTY_STYLE_HASH}'`);
  });

  it("style-src zostaje scisle (nonce, bez 'unsafe-inline') — zapas dla przegladarek bez CSP3", () => {
    expect(d.get("style-src")).toBe(`'self' 'nonce-${NONCE}' fonts.googleapis.com`);
  });

  it("style-src-elem: self, nonce, dwa hashe sonnera, fonts.googleapis.com", () => {
    expect(d.get("style-src-elem")).toBe(
      `'self' 'nonce-${NONCE}' '${SONNER_STYLE_HASH}' '${EMPTY_STYLE_HASH}' fonts.googleapis.com`,
    );
  });

  it("style-src-attr dopuszcza tylko atrybuty style", () => {
    expect(d.get("style-src-attr")).toBe("'unsafe-inline'");
  });

  it("'unsafe-inline' wystepuje wylacznie w style-src-attr", () => {
    for (const [name, value] of d) {
      if (name === "style-src-attr") continue;
      expect(value, name).not.toContain("'unsafe-inline'");
    }
  });

  it("nigdzie nie ma 'unsafe-hashes' ani 'unsafe-eval'", () => {
    expect(csp).not.toContain("'unsafe-hashes'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("script-src bez zmian", () => {
    expect(d.get("script-src")).toBe(
      `'self' 'nonce-${NONCE}' 'strict-dynamic' storage.googleapis.com`,
    );
  });

  it("pozostale dyrektywy bez zmian", () => {
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("font-src")).toBe("'self' fonts.gstatic.com");
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("worker-src")).toBe("'self'");
  });

  it("img-src: zasobnik GCS (C2) obok Vercel Blob — stare adresy ładują się do C4", () => {
    const img = (d.get("img-src") ?? "").split(" ");
    expect(img).toContain("storage.googleapis.com");
    expect(img).toContain("*.public.blob.vercel-storage.com");
  });
});

describe("buildCsp — development bez zmian", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dev ma luzne style-src i nie ma style-src-elem/style-src-attr", () => {
    vi.stubEnv("NODE_ENV", "development");
    const d = directives(buildCsp(NONCE));
    expect(d.get("style-src")).toBe("'self' 'unsafe-inline' fonts.googleapis.com");
    expect(d.has("style-src-elem")).toBe(false);
    expect(d.has("style-src-attr")).toBe(false);
    expect(d.get("script-src")).toBe(
      `'self' 'nonce-${NONCE}' 'strict-dynamic' 'unsafe-eval' storage.googleapis.com`,
    );
  });
});

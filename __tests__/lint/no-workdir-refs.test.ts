// @vitest-environment node
/**
 * Repozytorium jest publiczne: żaden plik śledzony przez git nie może zawierać
 * odwołania do lokalnego katalogu roboczego ani ścieżki bezwzględnej do
 * katalogu domowego (macOS i Linux). Jedyny wyjątek: `.gitignore` może
 * wymieniać katalog roboczy (żeby go ignorować).
 *
 * Wzorce są sklejane z części, żeby ten plik sam nie zawierał zakazanych
 * ciągów. Pliki binarne (bajt zerowy w pierwszych 8 kB) są pomijane.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");

const WORKDIR_REF = ["scratch", "pad", "/"].join("");
const HOME_MAC = ["/", "Users", "/"].join("");
const HOME_LINUX = ["/", "home", "/"].join("");

interface Rule {
  name: string;
  needle: string;
  except: ReadonlySet<string>;
}

const RULES: Rule[] = [
  { name: "katalog roboczy", needle: WORKDIR_REF, except: new Set([".gitignore"]) },
  { name: "ścieżka domowa macOS", needle: HOME_MAC, except: new Set() },
  { name: "ścieżka domowa Linux", needle: HOME_LINUX, except: new Set() },
];

function trackedFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files: kod ${r.status}`);
  return r.stdout.split("\0").filter(Boolean);
}

function readText(file: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(join(REPO_ROOT, file));
  } catch {
    return null; // plik usunięty w drzewie roboczym albo dowiązanie do katalogu
  }
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString("utf8");
}

const files = trackedFiles();
const texts = new Map<string, string>();
for (const f of files) {
  const t = readText(f);
  if (t !== null) texts.set(f, t);
}

function hits(rule: Rule): string[] {
  const out: string[] = [];
  for (const [file, text] of texts) {
    if (rule.except.has(file) || !text.includes(rule.needle)) continue;
    text.split("\n").forEach((line, i) => {
      if (line.includes(rule.needle)) out.push(`${file}:${i + 1}`);
    });
  }
  return out;
}

describe("pliki śledzone bez ścieżek roboczych i bezwzględnych", () => {
  it("skanuje pliki tekstowe z całego repozytorium, w tym dokumentację", () => {
    expect(texts.size).toBeGreaterThan(100);
    expect([...texts.keys()].some((f) => f.startsWith("docs/") && f.endsWith(".md"))).toBe(true);
    expect(texts.has("package.json")).toBe(true);
  });

  for (const rule of RULES) {
    it(`brak: ${rule.name}`, () => {
      const found = hits(rule);
      expect(found, `${rule.name} w plikach:\n${found.join("\n")}`).toEqual([]);
    });
  }
});

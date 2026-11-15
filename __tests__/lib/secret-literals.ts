// Wyszukiwanie literałów zmiennych klasy `secret` w plikach repozytorium
// (K-1, #144 W1). Używane przez __tests__/lib/secret-guard.test.ts: skrót
// każdej znalezionej wartości musi być na liście FORBIDDEN_SHA256.
//
// Tylko pliki śledzone przez git. Pliki `.env*` wyłącznie w wariancie
// `*.example` — prawdziwe pliki środowiska nigdy nie są czytane.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(__dirname, "..", "..");

export interface SecretLiteral {
  file: string;
  name: string;
  value: string;
}

/** Pliki, w których mogą siedzieć wartości testowe sekretów. */
export const SCANNED_FILE = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^docker-compose[^/]*\.ya?ml$/,
  /^\.env(\.[^/]+)?\.example$/,
  /^infra\/.+\.(sh|mjs|js|ya?ml|json)$/,
  /^scripts\/.+\.(sh|ts|mjs|js)$/,
  /^__tests__\/.+\.[cm]?[jt]sx?$/,
  /^tests\/.+\.[cm]?[jt]sx?$/,
  /^playwright[^/]*\.config\.[cm]?[jt]s$/,
  /^vitest[^/]*\.config\.[cm]?[jt]s$/,
];

export function secretClassNames(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "infra/gcp/env-manifest.json"), "utf8"),
  ) as { variables: Record<string, { class: string }> };
  return Object.entries(manifest.variables)
    .filter(([, v]) => v.class === "secret")
    .map(([k]) => k)
    .sort();
}

export function scannedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && SCANNED_FILE.some((re) => re.test(f)));
}

/** Odwołanie, a nie wartość: zmienna powłoki/YAML, szablon, wyrażenie. */
function isReference(value: string): boolean {
  return value === "" || value.includes("${") || value.startsWith("$");
}

function stripYamlScalar(raw: string): string {
  let v = raw.trim();
  const q = v[0];
  if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) return v.slice(1, v.indexOf(q, 1));
  v = v.replace(/\s+#.*$/, "");
  return v.trim();
}

export function extractSecretLiterals(
  files: string[] = scannedFiles(),
  names: string[] = secretClassNames(),
  read: (file: string) => string = (f) => readFileSync(join(REPO_ROOT, f), "utf8"),
): SecretLiteral[] {
  const N = names.join("|");
  const Q = `(["'\`])((?:\\\\.|(?!\\QUOTE)[^\\\\])*)\\QUOTE`;
  // Opcjonalne `.repeat(n)` z liczbą — wartość jak w kodzie testu ("a".repeat(32)).
  const quoted = (n: number) => Q.replace(/QUOTE/g, String(n)) + "(?:\\.repeat\\((\\d{1,4})\\))?";
  const yamlLine = new RegExp(`^\\s*(?:-\\s*)?["']?(${N})["']?\\s*[:=][ \\t]*(.*)$`, "gm");
  const shellAssign = new RegExp(
    `(?<![A-Za-z0-9_.])(${N})=(?:"([^"]*)"|'([^']*)'|([^\\s;"'\`]+))`,
    "g",
  );
  const codePatterns = [
    // vi.stubEnv("NAME", "v")
    new RegExp(`stubEnv\\(\\s*(["'\`])(${N})\\1\\s*,\\s*${quoted(3)}`, "g"),
    // process.env.NAME = "v" / process.env["NAME"] = "v"
    new RegExp(`process\\.env(?:\\.(${N})|\\[\\s*["'\`](${N})["'\`]\\s*\\])\\s*=\\s*${quoted(3)}`, "g"),
    // { NAME: "v" } / { "NAME": "v" }
    new RegExp(`(?<![A-Za-z0-9_.])["'\`]?(${N})["'\`]?\\s*:\\s*${quoted(2)}`, "g"),
  ];

  const out: SecretLiteral[] = [];
  const push = (file: string, name: string | undefined, value: string | undefined, repeat?: string) => {
    if (!name || value === undefined || isReference(value)) return;
    out.push({ file, name, value: repeat ? value.repeat(Number(repeat)) : value });
  };

  for (const file of files) {
    const text = read(file);
    const isYaml = /\.ya?ml$/.test(file);
    const isShellLike = /\.(sh|example)$/.test(file) || /^\.env/.test(file);
    if (isYaml) {
      for (const m of text.matchAll(yamlLine)) push(file, m[1], stripYamlScalar(m[2] ?? ""));
    }
    // NAME=v także w YAML (`- NAME=v`, `run: X=v cmd`) i w kodzie ("NAME=v").
    for (const m of text.matchAll(shellAssign)) push(file, m[1], m[2] ?? m[3] ?? m[4]);
    if (!isYaml && !isShellLike) {
      for (const m of text.matchAll(codePatterns[0]!)) push(file, m[2], m[4], m[5]);
      for (const m of text.matchAll(codePatterns[1]!)) push(file, m[1] ?? m[2], m[4], m[5]);
      for (const m of text.matchAll(codePatterns[2]!)) push(file, m[1], m[3], m[4]);
    }
  }
  return out;
}

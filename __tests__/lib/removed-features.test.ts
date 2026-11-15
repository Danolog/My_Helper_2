/**
 * G6 — strażnik funkcji USUNIĘTYCH z kodu (brief B, sekcja 5; rośnie w B3–B5).
 *
 * B3: asystent głosowy, dyktowanie i czytanie na głos (Twilio, ElevenLabs).
 * Test pada, gdy ktoś przywróci którąkolwiek ścieżkę, zależność, import,
 * odwołanie do trasy albo zmienną środowiskową. Przywrócenie funkcji to
 * świadoma decyzja: `git checkout v1.1.2-full -- <ścieżka>` + zmiana tego testu.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();

/** B3 — ścieżki usunięte (pliki i katalogi). */
const REMOVED_PATHS_B3 = [
  "src/app/api/ai/voice",
  "src/app/dashboard/ai-assistant/voice",
  "src/components/ai-assistant/voice",
  "src/components/ui/voice-textarea.tsx",
  "src/components/ui/read-aloud-button.tsx",
  "src/components/dashboard/voice-command-button.tsx",
  "src/hooks/use-voice-input.ts",
  "src/hooks/use-text-to-speech.ts",
  "src/lib/twilio.ts",
  "src/lib/ai/elevenlabs.ts",
];

/** B3 — pakiety usunięte z zależności. */
const REMOVED_PACKAGES_B3 = ["twilio", "elevenlabs"];

/** B3 — odwołania, których nie może być w kodzie `src` (.ts/.tsx). */
const FORBIDDEN_REFERENCES_B3: Array<[string, RegExp]> = [
  ["trasa /api/ai/voice", /\/api\/ai\/voice(\/|["'`?]|$)/m],
  ["import twilio", /from\s+["']twilio["']|require\(\s*["']twilio["']\s*\)/],
  ["import elevenlabs", /from\s+["']elevenlabs["']|require\(\s*["']elevenlabs["']\s*\)/],
  ["usunięte komponenty/hooki głosu", /voice-textarea|read-aloud-button|voice-command-button|use-voice-input|use-text-to-speech/],
];

/** B3 — zmienne środowiskowe, których env.ts nie może znać. */
const REMOVED_ENV_B3 = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "ELEVENLABS_API_KEY"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const SRC_FILES = sourceFiles(join(ROOT, "src")).map((file) => ({
  path: relative(ROOT, file),
  text: readFileSync(file, "utf8"),
}));

describe("G6 — usunięte funkcje nie wracają (B3: głos)", () => {
  it("kontrola: skaner widzi kod src (test nie jest pusty)", () => {
    expect(SRC_FILES.length).toBeGreaterThan(500);
  });

  it.each(REMOVED_PATHS_B3)("ścieżka %s nie istnieje", (path) => {
    expect(existsSync(join(ROOT, path)), path).toBe(false);
  });

  it.each(REMOVED_PACKAGES_B3)("package.json nie ma zależności %s", (pkg) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      expect(Object.keys(manifest[section] ?? {}), `${section}`).not.toContain(pkg);
    }
  });

  it.each(REMOVED_PACKAGES_B3)("pnpm-lock.yaml nie ma pakietu %s", (pkg) => {
    const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
    expect(lock).not.toMatch(new RegExp(`^\\s+/?${pkg}@`, "m"));
    expect(lock).not.toMatch(new RegExp(`^\\s+${pkg}:\\s*$`, "m"));
  });

  it.each(FORBIDDEN_REFERENCES_B3)("w src nie ma odwołania: %s", (_label, pattern) => {
    const hits = SRC_FILES.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it.each(REMOVED_ENV_B3)("env.ts nie zna zmiennej %s", (name) => {
    const env = readFileSync(join(ROOT, "src/lib/env.ts"), "utf8");
    expect(env).not.toContain(name);
  });
});

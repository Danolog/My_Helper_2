/**
 * G6 — strażnik funkcji USUNIĘTYCH z kodu (brief B, sekcja 5; rośnie w B3–B5).
 *
 * B3: asystent głosowy, dyktowanie i czytanie na głos (Twilio, ElevenLabs).
 * B4: generowanie wideo (Veo) i publikacja postów social (W, S).
 * Test pada, gdy ktoś przywróci którąkolwiek ścieżkę, zależność, import
 * (statyczny, `require`, dynamiczny `import()`), odwołanie do trasy, zmienną
 * środowiskową albo zluzuje nagłówki bezpieczeństwa po usuniętych dostawcach.
 * Przywrócenie funkcji to świadoma decyzja:
 * `git checkout v1.1.2-full -- <ścieżka>` + zmiana tego testu.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { buildCsp } from "@/proxy";
import nextConfig from "../../next.config";

const ROOT = process.cwd();

/** Ścieżki usunięte (pliki i katalogi). */
const REMOVED_PATHS = [
  // B3 — głos
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
  // B4 — wideo (W)
  "src/app/api/ai/video",
  "src/lib/ai/google-veo.ts",
  "src/components/content-generator/video-generator.tsx",
  "src/components/content-generator/story-generator.tsx",
  "src/components/content-generator/testimonial-template.tsx",
  "src/app/dashboard/content-generator/testimonials",
  // B4 — publikacja postów (S)
  "src/app/api/scheduled-posts",
  "src/app/api/ai/content/social-post",
  "src/app/api/cron/publish-scheduled-posts",
  "src/app/dashboard/content-generator/social-posts",
  "src/app/dashboard/content-generator/scheduled",
  "src/app/dashboard/content-generator/templates",
  "src/components/content-generator/image-generator.tsx",
];

/**
 * Pakiety usunięte z zależności. `@elevenlabs/elevenlabs-js` to obecna nazwa
 * SDK (stary `elevenlabs` jest „deprecated: moved to …”) — przywrócenie
 * głosu pod nową nazwą też ma paść (Leo, #109).
 */
const REMOVED_PACKAGES = ["twilio", "elevenlabs", "@elevenlabs/elevenlabs-js"];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Import pakietu w każdej formie: `from "x"`, `import "x"`, `require("x")`,
 * dynamiczny `import("x")` (Leo/Ryan, #109) — także podścieżki `x/…`.
 */
function importOf(pkg: string): RegExp {
  const name = escapeRegExp(pkg);
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'\x60]` + name + String.raw`(?:\/[^"'\x60]*)?["'\x60]`
  );
}

/** Odwołania, których nie może być w kodzie `src` (.ts/.tsx). */
const FORBIDDEN_REFERENCES: Array<[string, RegExp]> = [
  // B3
  ["trasa /api/ai/voice", /\/api\/ai\/voice(\/|["'`?]|$)/m],
  ["usunięte komponenty/hooki głosu", /voice-textarea|read-aloud-button|voice-command-button|use-voice-input|use-text-to-speech/],
  // B4
  ["trasa /api/ai/video", /\/api\/ai\/video(\/|["'`?]|$)/m],
  ["trasa /api/scheduled-posts", /\/api\/scheduled-posts(\/|["'`?]|$)/m],
  ["trasa /api/ai/content/social-post", /\/api\/ai\/content\/social-post(\/|["'`?]|$)/m],
  ["trasa /api/cron/publish-scheduled-posts", /\/api\/cron\/publish-scheduled-posts(\/|["'`?]|$)/m],
  ["usunięte moduły wideo i social", /google-veo|video-generator|story-generator|testimonial-template|image-generator/],
  // Importy usuniętych pakietów
  ...REMOVED_PACKAGES.map((pkg): [string, RegExp] => [`import ${pkg}`, importOf(pkg)]),
];

/** Zmienne środowiskowe usuniętych funkcji — nigdzie w `src` ani w `env.example` (Ryan, #109). */
const REMOVED_ENV = [
  // B3
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "ELEVENLABS_API_KEY",
  // B4
  "AI_MONTHLY_VIDEO_LIMIT",
];

/**
 * Prefiksy zmiennych usuniętych dostawców — żadna zmienna o tym prefiksie
 * (także nowa, np. `ELEVENLABS_VOICE_ID`) nie wraca do src ani env.example (Ryan, #109).
 */
const REMOVED_ENV_PREFIXES = ["TWILIO_", "ELEVENLABS_"];

/** Hosty usuniętych dostawców — nie mogą wrócić do CSP. */
const REMOVED_PROVIDER_HOSTS = /twilio|elevenlabs/i;

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

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

describe("G6 — usunięte funkcje nie wracają (B3: głos, B4: wideo i social)", () => {
  it("kontrola: skaner widzi kod src (test nie jest pusty)", () => {
    expect(SRC_FILES.length).toBeGreaterThan(500);
  });

  it.each(REMOVED_PATHS)("ścieżka %s nie istnieje", (path) => {
    expect(existsSync(join(ROOT, path)), path).toBe(false);
  });

  it.each(REMOVED_PACKAGES)("package.json nie ma zależności %s", (pkg) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      expect(Object.keys(manifest[section] ?? {}), `${section}`).not.toContain(pkg);
    }
  });

  it.each(REMOVED_PACKAGES)("pnpm-lock.yaml nie ma pakietu %s", (pkg) => {
    const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
    const name = escapeRegExp(pkg);
    // Klucz pakietu (`  x@1.2.3:` / `  '@s/x@1.2.3':`) i wpis importera (`      x:` / `      '@s/x':`).
    expect(lock).not.toMatch(new RegExp(`^\\s+'?/?${name}@`, "m"));
    expect(lock).not.toMatch(new RegExp(`^\\s+'?${name}'?:\\s*$`, "m"));
  });

  it.each(FORBIDDEN_REFERENCES)("w src nie ma odwołania: %s", (_label, pattern) => {
    const hits = SRC_FILES.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("kontrola: wzorzec importu łapie każdą formę (statyczny, side-effect, require, dynamiczny, podścieżka)", () => {
    const re = importOf("@elevenlabs/elevenlabs-js");
    for (const sample of [
      `import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";`,
      `import "@elevenlabs/elevenlabs-js";`,
      `const m = require( '@elevenlabs/elevenlabs-js' );`,
      `const m = await import("@elevenlabs/elevenlabs-js");`,
      "const m = await import(`@elevenlabs/elevenlabs-js/api`);",
    ]) {
      expect(re.test(sample), sample).toBe(true);
    }
    expect(importOf("twilio").test(`import x from "twilio-like";`)).toBe(false);
  });

  it.each(REMOVED_ENV)("zmienna %s nie występuje w src ani w env.example", (name) => {
    const hits = SRC_FILES.filter((f) => f.text.includes(name)).map((f) => f.path);
    expect(hits).toEqual([]);
    expect(readFileSync(join(ROOT, "env.example"), "utf8")).not.toContain(name);
  });

  it.each(REMOVED_ENV_PREFIXES)("żadna zmienna %s* w src ani w env.example", (prefix) => {
    const re = new RegExp(`\\b${prefix}[A-Z0-9_]+`);
    const hits = SRC_FILES.filter((f) => re.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
    expect(readFileSync(join(ROOT, "env.example"), "utf8")).not.toMatch(re);
  });
});

describe("G6 — nagłówki bezpieczeństwa po usunięciu głosu (Ryan, #109)", () => {
  it("Permissions-Policy: microphone=() (i kamera, geolokalizacja) dla wszystkich ścieżek", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((r) => r.source === "/(.*)");
    const policy = all?.headers.find((h) => h.key === "Permissions-Policy")?.value;
    expect(policy?.split(/,\s*/).sort()).toEqual(["camera=()", "geolocation=()", "microphone=()"]);
  });

  it("connect-src: dokładnie dozwolone hosty, bez usuniętych dostawców", () => {
    const connect = directives(buildCsp("n0nce")).get("connect-src");
    expect(connect).toEqual(["'self'", "*.googleapis.com", "accounts.google.com"]);
    expect(buildCsp("n0nce")).not.toMatch(REMOVED_PROVIDER_HOSTS);
  });
});

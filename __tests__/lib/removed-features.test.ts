/**
 * G6 — strażnik funkcji USUNIĘTYCH z kodu (brief B, sekcja 5; rośnie w B3–B5).
 *
 * B3: asystent głosowy, dyktowanie i czytanie na głos (Twilio, ElevenLabs).
 * B4: generowanie wideo (Veo) i publikacja postów social (W, S).
 * B5: fiskalizacja (F) i martwy `createRefundNotification`.
 * 2026-11-15: ogólny czat (strona /chat i trasa /api/chat, decyzja PO).
 * 2026-11-28: kategoryzacja (/api/ai/categorize) i analiza klienta przez AI
 * (/api/ai/clients/insights, zakładka na karcie klienta) — bez zastępstwa.
 * Usunięta trasa nie ma pliku route.ts, więc Next.js odpowiada na nią 404.
 * Test pada, gdy ktoś przywróci którąkolwiek ścieżkę, zależność, import
 * (statyczny, `require`, dynamiczny `import()`), odwołanie do trasy, zmienną
 * środowiskową albo zluzuje nagłówki bezpieczeństwa po usuniętych dostawcach.
 * Przywrócenie funkcji to świadoma decyzja:
 * `git checkout v1.1.2-full -- <ścieżka>` + zmiana tego testu.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { MODULES } from "@/lib/features";
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
  // B5 — fiskalizacja (F)
  "src/app/api/appointments/[id]/fiscal-receipt",
  "src/app/api/salons/[id]/fiscal-settings",
  "src/app/dashboard/settings/fiscal",
  "src/components/appointments/detail/appointment-fiscal-receipt-card.tsx",
  "src/components/appointments/detail/fiscal-receipt-dialog.tsx",
  // Ogólny czat (decyzja PO 2026-11-15) — czaty AI to asystent biznesowy i trendy
  "src/app/(site)/chat",
  "src/app/api/chat",
  // Kategoryzacja i analiza klienta przez AI — usunięte bez zastępstwa
  // (najszerszy zakres danych klientki; kategoryzacja bez wywołań w UI).
  "src/app/api/ai/categorize",
  "src/app/api/ai/clients/insights",
  "src/components/clients/client-insights-tab.tsx",
];

/**
 * Pakiety usunięte z zależności. `@elevenlabs/elevenlabs-js` to obecna nazwa
 * SDK (stary `elevenlabs` jest „deprecated: moved to …”) — przywrócenie
 * głosu pod nową nazwą też ma paść (recenzja, #109).
 */
const REMOVED_PACKAGES = ["twilio", "elevenlabs", "@elevenlabs/elevenlabs-js"];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Import pakietu w każdej formie: `from "x"`, `import "x"`, `require("x")`,
 * dynamiczny `import("x")` (recenzja/audyt bezpieczeństwa, #109) — także podścieżki `x/…`.
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
  // Cena video:google_veo w COST_MAP to tylko dane historyczne (decyzja produktowa,
  // #114) — żaden kod nie może zapisać nowego użycia wideo.
  ["zapis nowego użycia wideo (type video / provider google_veo)", /\btype:\s*["'`]video["'`]|\bprovider:\s*["'`]google_veo["'`]/],
  // Veo pod inną nazwą trasy albo przez re-eksport klienta Google (audyt bezpieczeństwa #114,
  // V8/V9): metoda SDK i identyfikatory modeli wideo nie wracają do src.
  ["wywołanie generateVideos (Veo)", /\bgenerateVideos\b/],
  ["identyfikator modelu veo-*", /["'`]veo-/i],
  // B5
  ["trasa /api/appointments/[id]/fiscal-receipt", /\/fiscal-receipt(\/|["'`?]|$)/m],
  ["trasa /api/salons/[id]/fiscal-settings", /\/fiscal-settings(\/|["'`?]|$)/m],
  [
    "usunięte komponenty, typy i schematy fiskalizacji",
    /fiscal-receipt-dialog|appointment-fiscal-receipt-card|FiscalReceiptDialog|AppointmentFiscalReceiptCard|FiscalReceiptData|fiscalSettingsSchema|fiscalReceiptSchema|fiscalTestSchema/,
  ],
  // Prefiks strony zostaje w ROUTE_MODULE_MAP (otwarta karta → pulpit), ale
  // żaden link (kafelek ustawień, paleta poleceń) nie może na nią prowadzić.
  ["link do /dashboard/settings/fiscal", /\bhref:\s*["'`]\/dashboard\/settings\/fiscal/],
  ["bramka modułu fiscal w interfejsie", /useModuleEnabled\(\s*["'`]fiscal["'`]\s*\)|<ModuleGate\s+module=["'`]fiscal["'`]/],
  ["martwy createRefundNotification", /\bcreateRefundNotification\b/],
  // Ogólny czat: trasa i strona (także w szablonie `${base}/chat`). Czaty
  // salonu żyją pod /api/ai/business/chat i /dashboard/ai-assistant/*.
  ["trasa /api/chat", /\/api\/chat(\/|["'`?#]|$)/m],
  ["link lub trasa chroniona /chat", /(["'`]|\})\/chat(\/[^"'`]*)?["'`]/],
  // useChat bez transportu woła domyślnie /api/chat
  ["useChat z @ai-sdk/react (domyślny endpoint /api/chat)", importOf("@ai-sdk/react")],
  // Kategoryzacja i analiza klienta przez AI
  ["trasa /api/ai/categorize", /\/api\/ai\/categorize(\/|["'`?#]|$)/m],
  ["trasa /api/ai/clients/insights", /\/api\/ai\/clients\/insights(\/|["'`?#]|$)/m],
  ["usunięta zakładka analizy klienta", /client-insights-tab|ClientInsightsTab/],
  // Importy usuniętych pakietów
  ...REMOVED_PACKAGES.map((pkg): [string, RegExp] => [`import ${pkg}`, importOf(pkg)]),
];

/** Zmienne środowiskowe usuniętych funkcji — nigdzie w `src` ani w `env.example` (audyt bezpieczeństwa, #109). */
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
 * (także nowa, np. `ELEVENLABS_VOICE_ID`) nie wraca do src ani env.example (audyt bezpieczeństwa, #109).
 */
const REMOVED_ENV_PREFIXES = ["TWILIO_", "ELEVENLABS_"];

/** Hosty usuniętych dostawców — nie mogą wrócić do CSP. */
const REMOVED_PROVIDER_HOSTS = /twilio|elevenlabs/i;

/**
 * Pliki kodu skanowane przez G6: TS i JS we wszystkich wariantach modułów
 * (.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs). Wcześniejszy filtr `.ts|.tsx`
 * przepuszczał trasę `route.js` z Veo albo odczytem `fiscalReceipts`
 * (recenzja z audytu bezpieczeństwa #117, J1–J3).
 */
const CODE_FILE = /\.(m|c)?[jt]sx?$/;

/** Pliki JS w src — projekt jest w TS, więc JS jest wyłącznie obejściem typów. */
const JS_FILE = /\.(m|c)?jsx?$/;

/**
 * Obejścia zawężenia typów przy zapisie użycia AI (audyt bezpieczeństwa #117, T1–T3):
 * rzutowanie `as any` / `as never` / `as unknown` w argumentach wywołania
 * `trackAIUsage(...)` albo dyrektywa `@ts-*` tuż nad wywołaniem. Zapis
 * i tak zatrzyma allowlista w czasie wykonania; reguła robi z obejścia
 * czerwony test, zanim kod trafi do recenzji.
 */
const TRACK_USAGE_CAST = /trackAIUsage\s*\([^;]*?\bas\s+(any|never|unknown)\b/;
const TRACK_USAGE_TS_DIRECTIVE =
  /@ts-(ignore|nocheck|expect-error)\b[^\n]*\n(\s*(\/\/|\/\*|\*)[^\n]*\n)*[^\n]*\btrackAIUsage\s*\(/;
const TRACK_USAGE_TYPE_BYPASS: Array<[string, RegExp]> = [
  ["rzutowanie w argumentach trackAIUsage", TRACK_USAGE_CAST],
  ["dyrektywa @ts-* nad wywołaniem trackAIUsage", TRACK_USAGE_TS_DIRECTIVE],
];

/**
 * Jedyny plik, który zapisuje do `aiGeneratedMedia` (audyt bezpieczeństwa #117, N6).
 * Kolumna `type` to `text`, więc bezpośredni insert z `"vid" + "eo"` omija
 * allowlistę `trackAIUsage`, regułę G6 na literały i tsc.
 */
const AI_MEDIA_WRITER = "src/lib/ai/openrouter.ts";
const AI_MEDIA_WRITE: Array<[string, RegExp]> = [
  // db./tx./dowolny klient, także `schema.aiGeneratedMedia` i łamanie linii.
  ["insert/update(aiGeneratedMedia)", /\.\s*(insert|update)\s*\(\s*(\w+\s*\.\s*)*aiGeneratedMedia\b/],
  // Alias tabeli: `aiGeneratedMedia as X`, `{ aiGeneratedMedia: X }`, `const X = aiGeneratedMedia;`.
  [
    "alias tabeli aiGeneratedMedia",
    /\baiGeneratedMedia\s+as\s+\w|\baiGeneratedMedia\s*:\s*[A-Za-z_$]|[=:]\s*(\w+\s*\.\s*)*aiGeneratedMedia\s*[;,)}\n]/,
  ],
  // Surowy SQL na nazwie tabeli.
  ["surowy SQL insert/update ai_generated_media", /\b(insert\s+into|update)\s+["'`]?(public["'`]?\.["'`]?)?ai_generated_media\b/i],
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (CODE_FILE.test(name)) out.push(full);
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

describe("G6 — usunięte funkcje nie wracają (B3: głos, B4: wideo i social, B5: fiskalizacja)", () => {
  it("kontrola: skaner widzi kod src (test nie jest pusty)", () => {
    expect(SRC_FILES.length).toBeGreaterThan(500);
  });

  it("w src nie ma plików .js/.jsx/.mjs/.cjs (omijają tsc i zawężenie typów, audyt bezpieczeństwa #117 J1–J3)", () => {
    const hits = SRC_FILES.filter((f) => JS_FILE.test(f.path)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it.each(TRACK_USAGE_TYPE_BYPASS)("w src nie ma obejścia typu zapisu użycia AI: %s", (_label, pattern) => {
    const hits = SRC_FILES.filter((f) => pattern.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("kontrola: reguły obejścia łapią as any / as never / as unknown / @ts-ignore, a nie zwykłe wywołanie", () => {
    const cast = TRACK_USAGE_CAST;
    const directive = TRACK_USAGE_TS_DIRECTIVE;
    for (const sample of [
      `void trackAIUsage(s, "x", {}, { type: ("vid" + "eo") as any });`,
      `trackAIUsage(s, "x", {}, {\n  type: t as never,\n});`,
      `trackAIUsage(s, "x", {}, { provider: p as unknown as "sharp" });`,
    ]) {
      expect(cast.test(sample), sample).toBe(true);
    }
    for (const sample of [
      `// @ts-ignore\n  trackAIUsage(s, "x", {}, { type: t });`,
      `/* @ts-expect-error */\nvoid trackAIUsage(s, "x");`,
      `// @ts-ignore\n// powód\nconst r = trackAIUsage(s, "x");`,
    ]) {
      expect(directive.test(sample), sample).toBe(true);
    }
    const plain = `void trackAIUsage(salonId, "banner", { style }, { type: "banner", provider: "google_imagen" });\nconst x = y as Record<string, unknown>;`;
    expect(cast.test(plain)).toBe(false);
    expect(directive.test(plain)).toBe(false);
  });

  it.each(AI_MEDIA_WRITE)(`zapis do aiGeneratedMedia tylko w ${AI_MEDIA_WRITER}: %s`, (_label, pattern) => {
    const hits = SRC_FILES.filter((f) => f.path !== AI_MEDIA_WRITER && pattern.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it(`kontrola: ${AI_MEDIA_WRITER} jest na liście skanera i zawiera jedyny insert`, () => {
    const writer = SRC_FILES.find((f) => f.path === AI_MEDIA_WRITER);
    expect(writer).toBeDefined();
    expect(AI_MEDIA_WRITE[0]![1].test(writer!.text)).toBe(true);
  });

  it("kontrola: reguły N6 łapią warianty zapisu, a nie odczyt", () => {
    const hit = (s: string) => AI_MEDIA_WRITE.some(([, re]) => re.test(s));
    for (const sample of [
      `await db.insert(aiGeneratedMedia).values({ type: "vid" + "eo" });`,
      `await tx\n  .insert(\n    aiGeneratedMedia,\n  )\n  .values(row);`,
      `await db.insert(schema.aiGeneratedMedia).values(row);`,
      `await db.update(aiGeneratedMedia).set({ type: t });`,
      `import { aiGeneratedMedia as media } from "@/lib/schema";`,
      `const { aiGeneratedMedia: media } = schema;`,
      `const media = aiGeneratedMedia;`,
      `const t = { table: schema.aiGeneratedMedia };`,
      "await db.execute(sql`INSERT INTO ai_generated_media (type) VALUES (${t})`);",
      `await db.execute(sql.raw('update "public"."ai_generated_media" set type = 1'));`,
    ]) {
      expect(hit(sample), sample).toBe(true);
    }
    for (const sample of [
      `import { aiGeneratedMedia } from "@/lib/schema";`,
      `const rows = await db.select({ type: aiGeneratedMedia.type }).from(aiGeneratedMedia).where(eq(aiGeneratedMedia.salonId, id));`,
      `.groupBy(aiGeneratedMedia.type, aiGeneratedMedia.provider);`,
      "// (`ai_generated_media.type = 'video'`): bez niego",
    ]) {
      expect(hit(sample), sample).toBe(false);
    }
  });

  it("kontrola: filtr skanera obejmuje każde rozszerzenie TS/JS, a nie inne pliki", () => {
    for (const name of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(CODE_FILE.test(name), name).toBe(true);
    }
    for (const name of ["a.json", "a.css", "a.md", "a.d.ts.bak", "a.tsbuildinfo"]) {
      expect(CODE_FILE.test(name), name).toBe(false);
    }
    expect(["a.js", "a.jsx", "a.mjs", "a.cjs"].every((n) => JS_FILE.test(n))).toBe(true);
    expect(["a.ts", "a.tsx", "a.mts", "a.cts"].some((n) => JS_FILE.test(n))).toBe(false);
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

  it("kontrola: reguły ogólnego czatu łapią trasę, link i szablon, a nie czaty salonu", () => {
    const rule = (label: string) => FORBIDDEN_REFERENCES.find(([l]) => l === label)![1];
    const api = rule("trasa /api/chat");
    const page = rule("link lub trasa chroniona /chat");
    for (const sample of [`fetch("/api/chat")`, "fetch(`/api/chat?x=1`)", `api: "/api/chat/"`]) {
      expect(api.test(sample), sample).toBe(true);
    }
    for (const sample of [`href: "/chat"`, `["/chat", "/dashboard"]`, "url: `${baseUrl}/chat`", `"/chat/:path*"`]) {
      expect(page.test(sample), sample).toBe(true);
    }
    for (const sample of [
      `fetch("/api/ai/business/chat")`,
      `href: "/dashboard/ai-assistant/business"`,
      `"/dashboard/ai-assistant/trends/chat"`,
    ]) {
      expect(api.test(sample) || page.test(sample), sample).toBe(false);
    }
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

describe("G6 — dane fiskalne zostają w bazie, kod nie (B5)", () => {
  it("tabela fiscalReceipts jest tylko w schemacie — żaden kod jej nie czyta ani nie pisze", () => {
    const hits = SRC_FILES.filter(
      (f) => f.path !== join("src", "lib", "schema.ts") && /\bfiscalReceipts\b|fiscal_receipts/.test(f.text)
    ).map((f) => f.path);
    expect(hits).toEqual([]);
    // Kontrola: definicja tabeli zostaje (brief B §3 — bez DROP, bez migracji).
    expect(SRC_FILES.find((f) => f.path === join("src", "lib", "schema.ts"))?.text).toMatch(
      /export const fiscalReceipts = pgTable\(\s*"fiscal_receipts"/
    );
  });

  it("etykiety i opisy modułów nie wymieniają usuniętych dostawców", () => {
    const hits = MODULES.filter((m) => REMOVED_PROVIDER_HOSTS.test(`${m.label} ${m.description}`)).map(
      (m) => m.key
    );
    expect(hits).toEqual([]);
  });
});

describe("G6 — nagłówki bezpieczeństwa po usunięciu głosu (audyt bezpieczeństwa, #109)", () => {
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

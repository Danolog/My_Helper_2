/**
 * Strażnik G-C1 (brief C, zadanie 0.2): konfiguracja kontenera Cloud Run.
 *
 * Pilnuje, że:
 * - `next.config.ts` buduje serwer samodzielny (`output: "standalone"`) tylko
 *   przy `BUILD_STANDALONE=1`, a tę zmienną ustawia wyłącznie etap `builder`
 *   w `Dockerfile` — Vercel (`vercel.json`) i CI (`.github/workflows/`) budują
 *   bez zmian do C4 (werdykt Ethana na #108);
 * - etap `runner` w `Dockerfile` jest domyślnym celem i działa jako
 *   użytkownik inny niż root;
 * - żaden etap nie kopiuje plików `.env*` i nie deklaruje `ARG`/`ENV`
 *   o nazwie sekretu (sekrety przychodzą w czasie działania);
 * - `.dockerignore` wycina pliki `.env*` na każdym poziomie katalogów (wpis
 *   z prefiksem `**` — nie tylko w katalogu głównym) i nie ma wyjątku
 *   `!.env…` (werdykt Ryana na #108).
 *
 * Test czyta pliki jako tekst — nie buduje obrazu.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

const ROOT = process.cwd();
const read = (relPath: string) => readFileSync(join(ROOT, relPath), "utf8");

// Klasa „sekret” z briefu C, sekcja 6 (do C3 — potem infra/gcp/env-manifest.json).
const SECRET_NAMES = [
  "POSTGRES_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "SMSAPI_TOKEN",
  "VAPID_PRIVATE_KEY",
  "CRON_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "OPENROUTER_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "GOOGLE_AI_API_KEY",
];
// Nazwy wyglądające na sekret, nawet spoza listy. NEXT_PUBLIC_* są jawne z definicji.
const SECRET_LIKE = /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)/;

interface DockerStage {
  name: string;
  /** Instrukcje z połączonymi liniami kontynuacji (`\`), bez komentarzy. */
  instructions: string[];
}

function parseDockerfile(text: string): DockerStage[] {
  const logical: string[] = [];
  let buf = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!buf && (line === "" || line.startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      buf += line.slice(0, -1) + " ";
      continue;
    }
    logical.push((buf + line).trim());
    buf = "";
  }
  if (buf.trim()) logical.push(buf.trim());

  const stages: DockerStage[] = [];
  for (const instr of logical) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(instr);
    if (from) {
      stages.push({ name: (from[1] ?? `#${stages.length}`).toLowerCase(), instructions: [] });
      continue;
    }
    stages.at(-1)?.instructions.push(instr);
  }
  return stages;
}

/** Nazwy zmiennych deklarowanych przez `ARG`/`ENV` w instrukcji (pusta lista dla innych). */
function declaredNames(instr: string): string[] {
  const m = /^(ARG|ENV)\s+(.*)$/i.exec(instr);
  if (!m) return [];
  const body = m[2] ?? "";
  // `ENV A=1 B=2`, `ARG A`, `ARG A=1`, stara forma `ENV A 1`.
  if (!body.includes("=")) return [body.split(/\s+/)[0] ?? ""];
  return [...body.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g)].map((x) => x[1] ?? "");
}

function isSecretName(name: string): boolean {
  if (name.startsWith("NEXT_PUBLIC_")) return false;
  return SECRET_NAMES.includes(name) || SECRET_LIKE.test(name);
}

function lastUser(stage: DockerStage): string | undefined {
  const users = stage.instructions.filter((i) => /^USER\s+/i.test(i));
  return users.at(-1)?.replace(/^USER\s+/i, "").trim();
}

const dockerfile = read("Dockerfile");
const stages = parseDockerfile(dockerfile);
const runner = stages.find((s) => s.name === "runner");

// Konfiguracja liczy się przy imporcie — każdy przypadek ładuje moduł od nowa.
async function loadNextConfig(buildStandalone: string | undefined) {
  vi.resetModules();
  if (buildStandalone === undefined) vi.stubEnv("BUILD_STANDALONE", undefined);
  else vi.stubEnv("BUILD_STANDALONE", buildStandalone);
  return (await import("../../next.config")).default;
}

describe("G-C1: next.config.ts — standalone tylko z BUILD_STANDALONE=1", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('BUILD_STANDALONE=1 → output "standalone"', async () => {
    expect((await loadNextConfig("1")).output).toBe("standalone");
  });

  it("bez zmiennej → output undefined (Vercel, CI)", async () => {
    expect((await loadNextConfig(undefined)).output).toBeUndefined();
  });

  it('BUILD_STANDALONE=0 → output undefined', async () => {
    expect((await loadNextConfig("0")).output).toBeUndefined();
  });
});

describe("G-C1: Dockerfile", () => {
  it("ma etap runner i jest on ostatni (domyślny cel `docker build`)", () => {
    expect(runner, "brak etapu `AS runner`").toBeDefined();
    expect(stages.at(-1)?.name).toBe("runner");
  });

  it("etap builder ustawia BUILD_STANDALONE=1 (ENV albo w RUN z build:ci)", () => {
    const builder = stages.find((s) => s.name === "builder");
    expect(builder, "brak etapu `AS builder`").toBeDefined();
    const viaEnv = builder!.instructions.some(
      (i) => /^ENV\s/i.test(i) && /(^|\s)BUILD_STANDALONE=("?)1\2(\s|$)/.test(i),
    );
    const viaRun = builder!.instructions.some(
      (i) => /^RUN\s/i.test(i) && /BUILD_STANDALONE=1\s[^&;|]*pnpm build:ci/.test(i),
    );
    expect(viaEnv || viaRun, "etap builder nie włącza standalone — runner nie miałby server.js").toBe(true);
  });

  it("BUILD_STANDALONE występuje w Dockerfile tylko w etapie builder", () => {
    const elsewhere = stages
      .filter((s) => s.name !== "builder")
      .flatMap((s) => s.instructions.filter((i) => i.includes("BUILD_STANDALONE")).map((i) => `${s.name}: ${i}`));
    expect(elsewhere).toEqual([]);
  });

  it("etap runner kończy się użytkownikiem innym niż root", () => {
    const user = lastUser(runner!);
    expect(user, "etap runner bez instrukcji USER — kontener działałby jako root").toBeDefined();
    expect(["root", "0", "0:0", "root:root"]).not.toContain(user);
  });

  it("etap migrator też nie działa jako root", () => {
    const migrator = stages.find((s) => s.name === "migrator");
    expect(migrator).toBeDefined();
    const user = lastUser(migrator!);
    expect(user).toBeDefined();
    expect(["root", "0", "0:0", "root:root"]).not.toContain(user);
  });

  it("żaden etap nie kopiuje plików .env*", () => {
    const offenders = stages.flatMap((s) =>
      s.instructions
        .filter((i) => /^(COPY|ADD)\s/i.test(i) && /(^|[\s/])\.env/.test(i))
        .map((i) => `${s.name}: ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  it("żaden etap nie deklaruje ARG/ENV o nazwie sekretu", () => {
    const offenders = stages.flatMap((s) =>
      s.instructions
        .flatMap((i) => declaredNames(i))
        .filter(isSecretName)
        .map((n) => `${s.name}: ${n}`),
    );
    expect(offenders).toEqual([]);
  });

  it("wartości zastępcze do budowy żyją tylko w RUN etapu builder", () => {
    const withPlaceholders = stages.flatMap((s) =>
      s.instructions
        .filter((i) => /POSTGRES_URL=|BETTER_AUTH_SECRET=/.test(i))
        .map((i) => ({ stage: s.name, isRun: /^RUN\s/i.test(i) })),
    );
    expect(withPlaceholders.length).toBeGreaterThan(0);
    for (const p of withPlaceholders) {
      expect(p).toEqual({ stage: "builder", isRun: true });
    }
  });
});

describe("G-C1: Vercel i CI nie włączają standalone (do C4)", () => {
  const workflowDir = ".github/workflows";
  const files = [
    "vercel.json",
    ...readdirSync(join(ROOT, workflowDir))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `${workflowDir}/${f}`),
  ];

  it("sprawdza vercel.json i co najmniej jeden workflow", () => {
    expect(files.length).toBeGreaterThan(1);
  });

  it.each(files)("%s nie zawiera BUILD_STANDALONE", (file) => {
    expect(read(file)).not.toContain("BUILD_STANDALONE");
  });
});

describe("G-C1: .dockerignore", () => {
  const entries = read(".dockerignore")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  it("wycina **/.env* z kontekstu budowy (także zagnieżdżone, nie tylko w katalogu głównym)", () => {
    expect(entries).toContain("**/.env*");
  });

  it("wycina pliki instrukcji agentów i kopie zapasowe (**/CLAUDE*.md, **/*.bak)", () => {
    expect(entries).toContain("**/CLAUDE*.md");
    expect(entries).toContain("**/*.bak");
  });

  it("nie ma wyjątku przywracającego plik .env", () => {
    expect(entries.filter((e) => /^!.*\.env/.test(e))).toEqual([]);
  });
});

describe("parser Dockerfile (samokontrola strażnika)", () => {
  const sample = [
    "FROM node:22 AS base",
    "ARG NEXT_PUBLIC_APP_URL",
    "ENV A=1 \\",
    "    STRIPE_SECRET_KEY=x",
    "FROM base AS runner",
    "# USER root",
    "USER node",
    "ENV CRON_SECRET placeholder",
  ].join("\n");
  const parsed = parseDockerfile(sample);

  it("dzieli na etapy i łączy linie kontynuacji", () => {
    expect(parsed.map((s) => s.name)).toEqual(["base", "runner"]);
    expect(parsed[0]!.instructions.flatMap(declaredNames)).toEqual([
      "NEXT_PUBLIC_APP_URL",
      "A",
      "STRIPE_SECRET_KEY",
    ]);
  });

  it("pomija komentarze i czyta starą formę ENV", () => {
    expect(lastUser(parsed[1]!)).toBe("node");
    expect(parsed[1]!.instructions.flatMap(declaredNames)).toEqual(["CRON_SECRET"]);
  });

  it("rozpoznaje sekrety, ale nie NEXT_PUBLIC_*", () => {
    expect(isSecretName("STRIPE_SECRET_KEY")).toBe(true);
    expect(isSecretName("POSTGRES_URL")).toBe(true);
    expect(isSecretName("SOME_API_KEY")).toBe(true);
    expect(isSecretName("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")).toBe(false);
    expect(isSecretName("NODE_ENV")).toBe(false);
  });
});

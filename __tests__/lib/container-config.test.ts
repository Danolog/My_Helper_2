/**
 * Strażnik G-C1 (brief C, zadanie 0.2): konfiguracja kontenera Cloud Run.
 *
 * Pilnuje, że:
 * - `next.config.ts` buduje serwer samodzielny (`output: "standalone"`) tylko
 *   przy `BUILD_STANDALONE=1`, a tę zmienną ustawia wyłącznie etap `builder`
 *   w `Dockerfile` — Vercel (`vercel.json`) i CI (`.github/workflows/`) budują
 *   bez zmian do C4 (werdykt z recenzji na #108);
 * - etap `runner` w `Dockerfile` jest domyślnym celem i działa jako
 *   użytkownik inny niż root;
 * - żaden etap nie kopiuje plików `.env*` i nie deklaruje `ARG`/`ENV`
 *   o nazwie sekretu (sekrety przychodzą w czasie działania);
 * - `.dockerignore` wycina pliki `.env*` na każdym poziomie katalogów (wpis
 *   z prefiksem `**` — nie tylko w katalogu głównym) i nie ma wyjątku
 *   `!.env…` (werdykt z audytu bezpieczeństwa na #108).
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
// Nazwy wyglądające na sekret, nawet spoza listy; porównanie bez wielkości liter
// (audyt bezpieczeństwa, #110 P3). NEXT_PUBLIC_* trafiają do przeglądarki, więc z definicji nie
// mogą być sekretem — nazwa z SECRET/TOKEN/PASSWORD/PRIVATE to błąd, nie wyjątek.
const SECRET_LIKE = /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)/i;
const PUBLIC_SECRET_LIKE = /(SECRET|TOKEN|PASSWORD|PRIVATE)/i;
const ROOT_USERS = ["root", "0", "0:0", "root:root", "root:0", "0:root"];

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
  const upper = name.toUpperCase();
  if (upper.startsWith("NEXT_PUBLIC_")) return PUBLIC_SECRET_LIKE.test(upper);
  return SECRET_NAMES.includes(upper) || SECRET_LIKE.test(upper);
}

function isRootOrDynamicUser(user: string): boolean {
  // `USER ${ARG}` — wartość znana dopiero przy budowie; może być root.
  return user.includes("$") || ROOT_USERS.includes(user.toLowerCase());
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

  it("etap runner kończy się stałym użytkownikiem innym niż root", () => {
    const user = lastUser(runner!);
    expect(user, "etap runner bez instrukcji USER — kontener działałby jako root").toBeDefined();
    expect(isRootOrDynamicUser(user!), `USER ${user}`).toBe(false);
  });

  it("etap migrator też nie działa jako root", () => {
    const migrator = stages.find((s) => s.name === "migrator");
    expect(migrator).toBeDefined();
    const user = lastUser(migrator!);
    expect(user).toBeDefined();
    expect(isRootOrDynamicUser(user!), `USER ${user}`).toBe(false);
  });

  it("runner kopiuje wyłącznie z etapu builder (żadnego COPY/ADD z kontekstu budowy)", () => {
    const fromContext = runner!.instructions.filter(
      (i) => /^(COPY|ADD)\s/i.test(i) && !/--from=builder(\s|$)/i.test(i),
    );
    expect(fromContext).toEqual([]);
  });

  it("pliki aplikacji w runner należą do root (bez --chown); zapisywalny tylko .next/cache", () => {
    const chowned = runner!.instructions.filter((i) => /^(COPY|ADD)\s/i.test(i) && /--chown/i.test(i));
    expect(chowned).toEqual([]);
    const chownRuns = runner!.instructions.filter((i) => /^RUN\s/i.test(i) && /chown/.test(i));
    expect(chownRuns).toEqual(["RUN mkdir -p .next/cache && chown node:node .next/cache"]);
  });

  it("runner nie tworzy plików .env* poleceniem RUN", () => {
    expect(runner!.instructions.filter((i) => /^RUN\s/i.test(i) && /\.env/i.test(i))).toEqual([]);
  });

  it("migrator ma tylko zależności produkcyjne i nie uruchamia drizzle-kit", () => {
    const prodDeps = stages.find((s) => s.name === "prod-deps");
    expect(prodDeps, "brak etapu `AS prod-deps`").toBeDefined();
    expect(prodDeps!.instructions).toContain("RUN pnpm install --frozen-lockfile --prod");
    const migrator = stages.find((s) => s.name === "migrator")!;
    const nodeModules = migrator.instructions.filter((i) => /^COPY\s.*node_modules/i.test(i));
    expect(nodeModules).toEqual(["COPY --from=prod-deps /app/node_modules ./node_modules"]);
    expect(migrator.instructions.join("\n")).not.toMatch(/drizzle-kit|db:migrate/);
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

  it("budowa nie dostaje żadnej wartości POSTGRES_URL ani BETTER_AUTH_SECRET (leniwe db, C3)", () => {
    const withValues = stages.flatMap((s) =>
      s.instructions.filter((i) => /POSTGRES_URL=|BETTER_AUTH_SECRET=/i.test(i)).map((i) => `${s.name}: ${i}`),
    );
    expect(withValues).toEqual([]);
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

  it("rozpoznaje sekrety, także małymi literami i udające NEXT_PUBLIC_*", () => {
    expect(isSecretName("STRIPE_SECRET_KEY")).toBe(true);
    expect(isSecretName("stripe_secret_key")).toBe(true);
    expect(isSecretName("POSTGRES_URL")).toBe(true);
    expect(isSecretName("postgres_url")).toBe(true);
    expect(isSecretName("SOME_API_KEY")).toBe(true);
    expect(isSecretName("NEXT_PUBLIC_STRIPE_SECRET_KEY")).toBe(true);
    expect(isSecretName("next_public_api_token")).toBe(true);
    expect(isSecretName("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")).toBe(false);
    expect(isSecretName("NEXT_PUBLIC_VAPID_PUBLIC_KEY")).toBe(false);
    expect(isSecretName("NODE_ENV")).toBe(false);
  });

  it("USER ze zmienną albo root (dowolna wielkość liter) jest odrzucany", () => {
    expect(isRootOrDynamicUser("${APP_USER}")).toBe(true);
    expect(isRootOrDynamicUser("$UID")).toBe(true);
    expect(isRootOrDynamicUser("ROOT")).toBe(true);
    expect(isRootOrDynamicUser("0:0")).toBe(true);
    expect(isRootOrDynamicUser("node")).toBe(false);
  });
});

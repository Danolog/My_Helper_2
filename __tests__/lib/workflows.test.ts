// @vitest-environment node
/**
 * Strażnik G-C6 (brief C §5, 7; #110): wdrożenie na Cloud Run.
 *  - deploy-cloud-run.yml: do C4 jedyny wyzwalacz to workflow_dispatch;
 *    `id-token: write`; zero kluczy JSON i sekretów GCP; akcje przypięte do sha;
 *  - obraz budowany pod linux/amd64 z 3 build-argami NEXT_PUBLIC_*;
 *  - zbudowany obraz sprawdzany (verify-image) i uruchamiany (smoke-container)
 *    PRZED wypchnięciem; nowa wersja bez ruchu → test dymny → promocja;
 *  - każda zmienna klasy `var` z manifestu idzie do usługi z `vars.*`,
 *    nic spoza klas secret/var nie trafia do usługi;
 *  - `STORAGE_DRIVER=gcs` nie jest wpisane na sztywno nigdzie w infra/ ani workflow;
 *  - e2e-production.yml: workflow_call + workflow_dispatch z base_url,
 *    deployment_status (Vercel) zostaje do C4.
 *  - wdraża tylko commit przebiegu z main: bez wejścia `ref`, warunek
 *    refs/heads/main, `merge-base --is-ancestor` przed budową; środowisko
 *    `production-gcp` (nie „Production" Vercela); jedna grupa concurrency;
 *  - e2e po wdrożeniu idzie na URL Cloud Run, nigdy na sekretny URL Vercela.
 * Mutacje: dopisać `push:`; przywrócić wejście `ref`; usunąć warunek main;
 * usunąć krok is-ancestor; environment → production; cancel-in-progress →
 * true; base_url → vars.NEXT_PUBLIC_APP_URL; BASE_URL z sekretu w workflow_call;
 * id-token: write z powrotem na poziomie workflow; `permissions: write-all`
 * na jobie e2e; allowlista bez https albo poluzowana do dowolnego hosta;
 * (#121 h) allowlista z powrotem na dowolny *.run.app, tag opcjonalny,
 * tag z kropką, ścieżka dopuszczona.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DEPLOY = read(".github/workflows/deploy-cloud-run.yml");
const E2E = read(".github/workflows/e2e-production.yml");
const RUN_DEPLOY = read("infra/gcp/run-deploy.sh");
const RUN_MIGRATE = read("infra/gcp/run-migrate.sh");
const MANIFEST = JSON.parse(read("infra/gcp/env-manifest.json")) as {
  variables: Record<string, { class: string; secretName?: string; required?: boolean }>;
};
const DOCKERFILE = read("Dockerfile");

/** Klucze najwyższego poziomu w bloku `on:` (wcięcie 2 spacje). */
function triggers(yaml: string): string[] {
  const block = yaml.match(/^on:\n((?:(?: {2}.*)?\n)*)/m);
  if (!block) throw new Error("Brak bloku on:");
  return [...block[1]!.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]!);
}

/** Jedyna nazwa środowiska wdrożeń Cloud Run (decyzja Olivera 15:52). */
const DEPLOY_ENVIRONMENT = "production-gcp";

const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

describe("G-C6: deploy-cloud-run.yml", () => {
  it("jedyny wyzwalacz: workflow_dispatch (push: main dopiero w C4)", () => {
    expect(triggers(DEPLOY)).toEqual(["workflow_dispatch"]);
  });

  it("jedyne wejście: run_migrations (domyślnie false); bez wejścia ref", () => {
    expect(DEPLOY).toMatch(/ {6}run_migrations:\n[\s\S]*?type: boolean\n\s+default: false/);
    const inputs = DEPLOY.match(/^ {4}inputs:\n((?: {6,}.*\n)*)/m)![1]!;
    expect([...inputs.matchAll(/^ {6}([a-z_]+):/gm)].map((m) => m[1])).toEqual(["run_migrations"]);
    expect(code(DEPLOY)).not.toContain("inputs.ref");
  });

  it("checkout bez ref z wejścia (commit przebiegu), pełna historia", () => {
    for (const m of code(DEPLOY).matchAll(/^\s+ref:\s*(.*)$/gm)) {
      expect(m[1], "ref:").not.toMatch(/inputs\./);
      expect(m[1], "ref:").toBe("${{ github.sha }}");
    }
    expect(DEPLOY).toMatch(/uses: actions\/checkout@[0-9a-f]{40}.*\n\s+with:\n\s+fetch-depth: 0\n/);
  });

  it("job deploy tylko z main, w środowisku production-gcp", () => {
    const job = DEPLOY.slice(DEPLOY.indexOf("\n  deploy:\n"), DEPLOY.indexOf("\n    steps:"));
    expect(job).toContain("\n    if: github.ref == 'refs/heads/main'\n");
    const envs = [...code(DEPLOY).matchAll(/^\s+environment:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
    expect(envs).toEqual([DEPLOY_ENVIRONMENT]);
    expect(job).toContain(`\n    environment: ${DEPLOY_ENVIRONMENT}\n`);
    // środowisko Vercela (nazwy środowisk GitHuba nie rozróżniają wielkości liter)
    expect(DEPLOY_ENVIRONMENT.toLowerCase()).not.toBe("production");
  });

  it("commit musi być na origin/main — sprawdzone przed pierwszą budową", () => {
    const check = DEPLOY.indexOf('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(DEPLOY.indexOf("docker build"));
    expect(DEPLOY.slice(check, DEPLOY.indexOf("\n\n", check))).toContain("exit 1");
  });

  it("concurrency: jedna grupa wdrożeń, bez anulowania trwającego", () => {
    expect(DEPLOY).toMatch(/^concurrency:\n {2}group: deploy-cloud-run\n {2}cancel-in-progress: false\n/m);
  });

  it("permissions: workflow i job e2e tylko contents: read; id-token: write wyłącznie na jobie deploy", () => {
    expect(DEPLOY).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
    const deployJob = DEPLOY.slice(DEPLOY.indexOf("\n  deploy:\n"), DEPLOY.indexOf("\n    steps:"));
    expect(deployJob).toContain("\n    permissions:\n      id-token: write\n      contents: read\n");
    const e2eJob = DEPLOY.slice(DEPLOY.indexOf("\n  e2e:\n"));
    expect([...e2eJob.matchAll(/^ {4}permissions:(.*)$/gm)].map((m) => m[1])).toEqual([""]);
    expect(e2eJob).toMatch(/\n {4}permissions:\n {6}contents: read\n(?! {6})/);
    const c = code(DEPLOY);
    expect(c.match(/id-token:/g)).toHaveLength(1);
    expect(c).not.toMatch(/write-all/);
  });

  it("bez kluczy JSON i bez sekretów w workflow (tylko vars.*)", () => {
    const c = code(DEPLOY);
    expect(c).not.toContain("credentials_json");
    expect(c).not.toMatch(/secrets\.GCP_/);
    expect(c).not.toMatch(/\bsecrets\.[A-Z]/);
    expect(c).toContain("workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}");
  });

  it("akcje zewnętrzne przypięte do pełnego sha", () => {
    const uses = [...code(DEPLOY).matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      if (u.startsWith("./")) continue;
      expect(u, u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("budowa linux/amd64, 3 build-argi NEXT_PUBLIC_* i GCS_BUCKET", () => {
    // polecenie z kontynuacjami `\` — do pierwszego końca linii bez `\` przed nim
    const builds = [...DEPLOY.matchAll(/docker build ([\s\S]*?)(?<!\\)\n/g)].map((m) => m[1]!);
    expect(builds).toHaveLength(2);
    for (const b of builds) expect(b).toContain("--platform linux/amd64");
    const runner = builds.find((b) => b.includes("--target runner"))!;
    for (const arg of [
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
      "GCS_BUCKET",
      "GCS_PUBLIC_BASE_URL",
    ]) {
      expect(runner).toContain(`--build-arg ${arg}`);
    }
    expect(builds.some((b) => b.includes("--target migrator"))).toBe(true);
  });

  it("kolejność: verify-image i smoke-container przed push; deploy bez ruchu → test dymny → promote", () => {
    const at = (s: string) => {
      const i = DEPLOY.indexOf(s);
      expect(i, s).toBeGreaterThan(0);
      return i;
    };
    const verify = at("infra/gcp/verify-image.sh");
    const smoke = at("infra/gcp/smoke-container.sh");
    const push = at("docker push");
    const migrate = at("infra/gcp/run-migrate.sh");
    const deploy = at("infra/gcp/run-deploy.sh deploy");
    const revisionSmoke = at("/api/health");
    const promote = at("infra/gcp/run-deploy.sh promote");
    expect(verify).toBeLessThan(push);
    expect(smoke).toBeLessThan(push);
    expect(push).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(promote);
    expect(DEPLOY.indexOf("/api/health", deploy)).toBeLessThan(promote);
    expect(revisionSmoke).toBeGreaterThan(0);
    expect(DEPLOY).toContain("if: ${{ inputs.run_migrations }}");
  });

  it("każda zmienna klasy var z manifestu idzie do usługi z vars.*", () => {
    const vars = Object.entries(MANIFEST.variables)
      .filter(([, e]) => e.class === "var")
      .map(([n]) => n);
    for (const name of vars) {
      expect(DEPLOY, name).toMatch(new RegExp(`^\\s+${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, "m"));
    }
  });

  it("nic spoza klas secret/var/build nie jest przekazywane do workflow", () => {
    const forbidden = Object.entries(MANIFEST.variables)
      .filter(([, e]) => ["ci-only", "removed-after-b", "vercel-only"].includes(e.class))
      .map(([n]) => n);
    for (const name of forbidden) expect(code(DEPLOY), name).not.toContain(name);
  });

  it("e2e po wdrożeniu przez workflow_call na URL Cloud Run (tag rewizji), bez sekretów", () => {
    const e2e = DEPLOY.slice(DEPLOY.indexOf("\n  e2e:\n"));
    expect(e2e).toContain("uses: ./.github/workflows/e2e-production.yml");
    expect(code(e2e)).toMatch(/\n\s+with:\n\s+base_url: \$\{\{ needs\.deploy\.outputs\.tag_url \}\}\n/);
    expect(code(e2e)).not.toContain("secrets");
  });
});

describe("G-C6: GCS_PUBLIC_BASE_URL — jedno źródło dla budowy i usługi (K-1, #133 pkt 1)", () => {
  it("vars.GCS_PUBLIC_BASE_URL dokładnie raz, w env joba deploy (widzi je build i run-deploy.sh)", () => {
    const c = code(DEPLOY);
    expect(c.match(/vars\.GCS_PUBLIC_BASE_URL/g)).toHaveLength(1);
    expect(c).toMatch(/\n {4}env:\n(?: {6}.*\n)*? {6}GCS_PUBLIC_BASE_URL: \$\{\{ vars\.GCS_PUBLIC_BASE_URL \}\}\n/);
    // żaden krok nie nadpisuje jej własną wartością
    expect(c.match(/^\s+GCS_PUBLIC_BASE_URL:/gm)).toHaveLength(1);
  });

  it("Dockerfile: ARG GCS_PUBLIC_BASE_URL przekazany do ENV etapu builder (next.config.ts)", () => {
    const builder = DOCKERFILE.slice(DOCKERFILE.indexOf(" AS builder"), DOCKERFILE.indexOf(" AS prod-deps"));
    expect(builder).toMatch(/^ARG GCS_PUBLIC_BASE_URL$/m);
    expect(builder).toContain("GCS_PUBLIC_BASE_URL=${GCS_PUBLIC_BASE_URL}");
  });
});

describe("G-C6: skrypty wdrożenia", () => {
  it("run-deploy.sh: sekrety i zmienne tylko z manifestu (secret/var), --env-vars-file, bez --update-env-vars", () => {
    expect(RUN_DEPLOY).toContain('e.class === "secret"');
    expect(RUN_DEPLOY).toContain('e.class === "var"');
    expect(RUN_DEPLOY).toContain("--env-vars-file=");
    expect(RUN_DEPLOY).toContain("--set-secrets=");
    expect(code(RUN_DEPLOY)).not.toContain("--update-env-vars");
    expect(code(RUN_DEPLOY)).not.toContain("--set-env-vars");
  });

  it("run-deploy.sh: sonda startowa na /api/health, bez sondy żywotności, nowa wersja bez ruchu", () => {
    expect(RUN_DEPLOY).toContain("--startup-probe=");
    expect(RUN_DEPLOY).toContain("httpGet.path=/api/health");
    expect(code(RUN_DEPLOY)).not.toContain("--liveness-probe");
    expect(RUN_DEPLOY).toContain("--no-traffic");
  });

  it.each([
    ["run-deploy.sh", RUN_DEPLOY],
    ["run-migrate.sh", RUN_MIGRATE],
  ])("%s: każde gcloud z jawnym --project, błąd braku zmiennych przed pierwszym gcloud", (_n, text) => {
    expect(text).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$/m);
    const lines = code(text).split("\n");
    expect(lines.filter((l) => /\bgcloud\b/.test(l) && !l.startsWith("GC=("))).toEqual([]);
    expect(text.indexOf("missing required env")).toBeLessThan(text.search(/"\$\{GC\[@\]\}"/));
  });

  it("run-deploy.sh: bez --allow-unauthenticated (zachowuje istniejącą politykę IAM; K-1)", () => {
    expect(code(RUN_DEPLOY)).not.toMatch(/--(no-)?allow-unauthenticated/);
    expect(code(RUN_DEPLOY)).not.toMatch(/add-iam-policy-binding|set-iam-policy/);
  });

  it.each([
    ["run-deploy.sh", RUN_DEPLOY],
    ["run-migrate.sh", RUN_MIGRATE],
  ])("%s: Cloud SQL przez konektor — --set-cloudsql-instances z PROJECT_ID:REGION:SQL_INSTANCE (K-1)", (_n, text) => {
    expect(text).toContain('CLOUDSQL_INSTANCE="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"');
    expect(code(text)).toContain('--set-cloudsql-instances="$CLOUDSQL_INSTANCE"');
    expect(code(text)).not.toContain("--add-cloudsql-instances");
  });

  it("manifest: klucze AI (OpenRouter, Google AI, ElevenLabs) poza Secret Manager i nigdy required — aplikacja startuje bez nich", () => {
    const ai = Object.entries(MANIFEST.variables).filter(([n]) => /OPENROUTER|GOOGLE_AI|GEMINI|ELEVENLABS|VERTEX/.test(n) && /KEY|TOKEN|SECRET/.test(n));
    expect(ai.map(([n]) => n).sort()).toEqual(["ELEVENLABS_API_KEY", "GOOGLE_AI_API_KEY", "OPENROUTER_API_KEY"]);
    for (const [n, e] of ai) {
      expect(e.class, n).not.toBe("secret");
      expect(e.required, n).not.toBe(true);
    }
  });

  it("manifest: każdy sekret ma jawne required; wymagane dokładnie postgres-url i better-auth-secret", () => {
    const secrets = Object.values(MANIFEST.variables).filter((e) => e.class === "secret");
    for (const e of secrets) expect(typeof e.required, e.secretName).toBe("boolean");
    expect(secrets.filter((e) => e.required).map((e) => e.secretName).sort()).toEqual(["better-auth-secret", "postgres-url"]);
  });

  it("run-migrate.sh: kopia zapasowa przed migracją, POSTGRES_URL z sekretu z manifestu", () => {
    const secretName = MANIFEST.variables.POSTGRES_URL!.secretName;
    expect(RUN_MIGRATE).toContain(`--set-secrets="POSTGRES_URL=${secretName}:latest"`);
    expect(RUN_MIGRATE.indexOf("sql backups create")).toBeLessThan(RUN_MIGRATE.indexOf("jobs execute"));
    expect(RUN_MIGRATE).toContain("--wait");
  });

  it("STORAGE_DRIVER=gcs nie jest wpisane na sztywno w infra/ ani w workflow (wartość tylko z vars, krok D)", () => {
    const files = [
      ...readdirSync(join(ROOT, "infra/gcp")).map((f) => `infra/gcp/${f}`),
      ...readdirSync(join(ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`),
      "docker-compose.app.yml",
      "Dockerfile",
    ];
    for (const f of files) {
      expect(read(f), f).not.toMatch(/STORAGE_DRIVER["']?\s*[:=]\s*["']?gcs/);
    }
  });
});

describe("G-C6: e2e-production.yml", () => {
  it("deployment_status (Vercel, do C4) + workflow_call", () => {
    expect(triggers(E2E)).toEqual(["deployment_status", "workflow_call"]);
  });

  it("workflow_call: base_url wymagane", () => {
    expect(E2E).toMatch(/ {2}workflow_call:\n {4}inputs:\n {6}base_url:\n(?: {8}.*\n)*? {8}required: true\n/);
  });

  it("BASE_URL: sekret Vercela tylko dla deployment_status, w workflow_call wyłącznie inputs.base_url", () => {
    expect(E2E).toContain(
      "BASE_URL: ${{ github.event_name == 'deployment_status' && secrets.BETTER_AUTH_BASE_URL_PROD || inputs.base_url }}",
    );
    // sekret produkcji pojawia się dokładnie raz, w gałęzi deployment_status
    expect(code(E2E).match(/secrets\./g)).toHaveLength(1);
  });

  const guardStep = () => {
    const at = E2E.indexOf("Cloud Run mode must target our tagged Cloud Run URL");
    expect(at).toBeGreaterThan(0);
    return { at, step: E2E.slice(at, E2E.indexOf("\n\n", at)) };
  };

  it("tryb Cloud Run: krok-allowlista przed checkoutem, tylko poza deployment_status", () => {
    const { at, step } = guardStep();
    expect(at).toBeLessThan(E2E.indexOf("actions/checkout"));
    expect(step).toContain("if: github.event_name != 'deployment_status'");
    expect(step).toContain('"$BASE_URL" != https://*');
    expect(step).toContain('"$BASE_URL" == *vercel.app*');
    // #121 (h): sufiks naszej usługi (usługa, numer projektu, region), bez ścieżki.
    expect(step).toContain("---myhelper-843777043748\\.europe-central2\\.run\\.app/?$");
    expect(step).toContain("exit 1");
  });

  it.each([
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app", 0],
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app/", 0],
    ["", 1],
    ["http://sha-99fe315---myhelper-843777043748.europe-central2.run.app", 1],
    // cudze lub inne usługi Cloud Run (#121 h)
    ["https://myhelper-abc123-lm.a.run.app", 1],
    ["https://sha-99fe315---myhelper-abc123-lm.a.run.app", 1],
    ["https://sha-99fe315---evil-843777043748.europe-central2.run.app", 1],
    ["https://sha-99fe315---myhelper-111111111111.europe-central2.run.app", 1],
    ["https://sha-99fe315---myhelper-843777043748.europe-west1.run.app", 1],
    ["https://sha-99fe315---myhelper-843777043748-europe-central2.run.app", 1],
    ["https://x.sha-99fe315---myhelper-843777043748.europe-central2.run.app", 1],
    // adres usługi bez taga (e2e idzie wyłącznie na tag_url)
    ["https://myhelper-843777043748.europe-central2.run.app", 1],
    ["https://---myhelper-843777043748.europe-central2.run.app", 1],
    // ścieżka, userinfo, port, doklejony host
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app/x", 1],
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app.evil.com", 1],
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app@evil.com", 1],
    ["https://evil.com@sha-99fe315---myhelper-843777043748.europe-central2.run.app", 1],
    ["https://sha-99fe315---myhelper-843777043748.europe-central2.run.app:8443", 1],
    ["https://myhelper.vercel.app", 1],
    ["https://my-helper-2.vercel.app.run.app.evil.com", 1],
    ["https://myhelper.pl", 1],
    ["https://evil.com/x.run.app", 1],
    ["https://run.app", 1],
    // #121 (f): kropka na początku i podwójna kropka w hoście
    ["https://.x.run.app", 1],
    ["https://a..run.app", 1],
    ["https://SHA-99FE315---myhelper-843777043748.europe-central2.run.app", 1],
  ])("allowlista (wykonana w bash): %j → exit %i", (url, exit) => {
    const { step } = guardStep();
    const script = step
      .split("\n")
      .slice(step.split("\n").findIndex((l) => l.trim() === "run: |") + 1)
      .map((l) => l.replace(/^ {10}/, ""))
      .join("\n");
    const r = spawnSync("bash", ["-c", script], { env: { NODE_ENV: "test", BASE_URL: url }, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(exit);
  });

  it("deployment_status nadal tylko dla udanego Production", () => {
    expect(E2E).toContain(
      "github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'",
    );
  });
});

describe("G-C6: run-deploy.sh — tylko sekrety z wersją (K-1, wykonane z fałszywym gcloud)", () => {
  const dir = mkdtempSync(join(tmpdir(), "g-c6-deploy-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "gcloud"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *"secrets versions describe"*) echo "unexpected describe" >&2; exit 9 ;;
  *"secrets versions list "*)
    # Jak prawdziwy gcloud: kod 0 i puste wyjście dla sekretu bez wersji.
    # Historia wersji w FAKE_SECRETS: najstarsza>…>najnowsza (np. ENABLED>DISABLED).
    # Bez --sort-by=~createTime kolejność od najstarszej; bez --limit=1 wszystkie.
    sec=$(printf '%s\\n' "$@" | awk 'p==1{print; exit} $0=="list"{p=1}')
    st=$(printf '%s\\n' "$FAKE_SECRETS" | tr ',' '\\n' | sed -n "s/^$sec=//p")
    case "$st" in
      DENIED) echo "ERROR: (gcloud.secrets.versions.list) PERMISSION_DENIED: denied" >&2; exit 1 ;;
      NOTFOUNDTEXT) echo "ERROR: (gcloud.secrets.versions.list) NOT_FOUND: Secret [$sec] not found" >&2; exit 1 ;;
      ""|EMPTY) exit 0 ;;
    esac
    hist=$(printf '%s\\n' "$st" | tr '>' '\\n')
    case "$*" in *"--sort-by=~createTime"*) hist=$(printf '%s\\n' "$hist" | awk '{a[NR]=$0} END{for(i=NR;i>0;i--)print a[i]}') ;; esac
    case "$*" in *"--limit=1"*) hist=$(printf '%s\\n' "$hist" | head -n1) ;; esac
    printf '%s\\n' "$hist" ;;
  *"run services describe"*) echo "https://sha-1234567---myhelper-843777043748.europe-central2.run.app" ;;
  *" run deploy "*)
    f=$(printf '%s\n' "$@" | sed -n 's/^--env-vars-file=//p')
    [ -n "$f" ] && sed 's/^/ENVFILE /' "$f" >> "$FAKE_LOG" ;;
esac
exit 0
`,
  );
  chmodSync(join(dir, "gcloud"), 0o755);
  let n = 0;
  const deploy = (secrets: string, extra: Record<string, string> = {}) => {
    const log = join(dir, `log-${n++}`);
    writeFileSync(log, "");
    const r = spawnSync("bash", [join(ROOT, "infra/gcp/run-deploy.sh"), "deploy"], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${dir}:${process.env.PATH}`,
        FAKE_LOG: log,
        FAKE_SECRETS: secrets,
        PROJECT_ID: "my-helper-2-488419",
        REGION: "europe-central2",
        SERVICE: "myhelper",
        IMAGE: "europe-central2-docker.pkg.dev/my-helper-2-488419/myhelper/myhelper:abc",
        RUNTIME_SA: "myhelper-runtime@my-helper-2-488419.iam.gserviceaccount.com",
        REVISION_TAG: "sha-1234567",
        SQL_INSTANCE: "myhelper-pg",
        BETTER_AUTH_URL: "https://example.test",
        STORAGE_DRIVER: "gcs",
        GCS_BUCKET: "mh-media",
        ...extra,
      },
    });
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    const calls = lines.filter((c) => !c.startsWith("ENVFILE "));
    const envFile = lines.filter((c) => c.startsWith("ENVFILE ")).map((c) => c.slice("ENVFILE ".length));
    const run = calls.find((c) => c.includes(" run deploy "));
    const listed = calls.filter((c) => c.includes("secrets versions list "));
    const described = listed.map((c) => {
      const a = c.split(" ");
      return a[a.indexOf("list") + 1]!;
    });
    return { ...r, calls, run, envFile, described, listed };
  };
  const REQUIRED = "postgres-url=ENABLED,better-auth-secret=ENABLED";
  const secretsArg = (run: string) => run.split(" ").find((a) => a.startsWith("--set-secrets="))!.slice("--set-secrets=".length).split(",");
  // Wpis --set-secrets złożony z części: bez nowego literału NAZWA=wartość (G-K1, lista zakazana).
  const mapping = (env: string, secret: string) => `${env}=${secret}:latest`;

  it("wymagane z wersją, opcjonalne bez → deploy tylko z wymaganymi; opcjonalne pominięte z komunikatem", () => {
    const r = deploy(REQUIRED);
    expect(r.status, r.stderr).toBe(0);
    expect(secretsArg(r.run!).sort()).toEqual(["BETTER_AUTH_SECRET=better-auth-secret:latest", "POSTGRES_URL=postgres-url:latest"]);
    expect(r.stdout).toMatch(/skip: optional secret stripe-webhook-secret has no enabled version/);
  });

  it("opcjonalny z wersją ENABLED jest mapowany; DISABLED nie", () => {
    const r = deploy(`${REQUIRED},cron-secret=ENABLED,resend-api-key=DISABLED`);
    expect(r.status, r.stderr).toBe(0);
    expect(secretsArg(r.run!)).toContain(mapping("CRON_SECRET", "cron-secret"));
    expect(secretsArg(r.run!).join(",")).not.toContain("resend-api-key");
  });

  // K-1b: stan wersji z `versions list` (najnowsza wersja), nie z tekstu błędu describe.
  it("odczyt: `versions list <sekret> --sort-by=~createTime --limit=1 --format=value(state)`, bez describe", () => {
    const r = deploy(REQUIRED);
    expect(r.status, r.stderr).toBe(0);
    expect(r.listed.length).toBeGreaterThan(0);
    for (const c of r.listed) {
      const a = c.split(" ");
      expect(a, c).toEqual(expect.arrayContaining(["--sort-by=~createTime", "--limit=1", "--format=value(state)"]));
    }
    expect(r.calls.some((c) => c.includes("versions describe"))).toBe(false);
  });

  it("pusty kontener (sekret bez wersji, kod 0) wymaganego sekretu → kod 2 z nazwą sekretu, przed deployem", () => {
    const r = deploy("postgres-url=EMPTY,better-auth-secret=ENABLED");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("error: required secret postgres-url has no versions");
    expect(r.run).toBeUndefined();
  });

  it("jest wersja ENABLED → przechodzi; liczy się NAJNOWSZA wersja (alias latest)", () => {
    const ok = deploy("postgres-url=DISABLED>ENABLED,better-auth-secret=ENABLED");
    expect(ok.status, ok.stderr).toBe(0);
    expect(secretsArg(ok.run!)).toContain("POSTGRES_URL=postgres-url:latest");
    const newestDisabled = deploy("postgres-url=ENABLED>DISABLED,better-auth-secret=ENABLED");
    expect(newestDisabled.status).toBe(2);
    expect(newestDisabled.stderr).toMatch(/required secrets without an enabled version: postgres-url/);
    expect(newestDisabled.run).toBeUndefined();
  });

  it("kod ≠ 0 z tekstem NOT_FOUND to błąd odczytu, nie „brak wersji” (bez rozpoznawania po stderr)", () => {
    const r = deploy(`${REQUIRED},cron-secret=NOTFOUNDTEXT`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("cannot read versions of secret cron-secret");
    expect(r.run).toBeUndefined();
  });

  // K-1b: para Stripe — oba albo żaden.
  it.each([
    ["tylko klucz API", "stripe-secret-key=ENABLED", "STRIPE_SECRET_KEY"],
    ["tylko sekret webhooka", "stripe-webhook-secret=ENABLED", "STRIPE_WEBHOOK_SECRET"],
    ["klucz API + webhook DISABLED", "stripe-secret-key=ENABLED,stripe-webhook-secret=DISABLED", "STRIPE_SECRET_KEY"],
  ])("para Stripe: %s → kod 2 z nazwami zmiennych, przed deployem", (_l, stripe, only) => {
    const r = deploy(`${REQUIRED},${stripe}`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must both have an enabled version or neither (only ${only})`);
    expect(r.run).toBeUndefined();
  });

  it("para Stripe: obie z wersją → obie mapowane; żadna → deploy bez Stripe", () => {
    const both = deploy(`${REQUIRED},stripe-secret-key=ENABLED,stripe-webhook-secret=ENABLED`);
    expect(both.status, both.stderr).toBe(0);
    expect(secretsArg(both.run!)).toEqual(
      expect.arrayContaining(["STRIPE_SECRET_KEY=stripe-secret-key:latest", mapping("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret")]),
    );
    const none = deploy(REQUIRED);
    expect(none.status, none.stderr).toBe(0);
    expect(secretsArg(none.run!).join(",")).not.toContain("stripe");
  });

  it.each([
    ["brak wersji", "better-auth-secret=ENABLED"],
    ["wersja wyłączona", "postgres-url=DISABLED,better-auth-secret=ENABLED"],
  ])("wymagany sekret: %s → kod 2 PRZED gcloud run deploy", (_l, secrets) => {
    const r = deploy(secrets);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/required secrets without an enabled version: postgres-url/);
    expect(r.run).toBeUndefined();
  });

  it("błąd odczytu inny niż brak wersji (np. uprawnienia) → kod 2, bez cichego pominięcia", () => {
    const r = deploy(`${REQUIRED},smsapi-token=DENIED`);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cannot read versions of secret smsapi-token/);
    expect(r.run).toBeUndefined();
  });

  it("deploy: --set-cloudsql-instances z nazwą połączenia, bez --allow-unauthenticated", () => {
    const r = deploy(REQUIRED);
    expect(r.run).toContain("--set-cloudsql-instances=my-helper-2-488419:europe-central2:myhelper-pg");
    expect(r.run).not.toMatch(/allow-unauthenticated/);
    expect(r.stdout).toContain("tag_url=https://sha-1234567---myhelper-843777043748.europe-central2.run.app");
  });

  // Ryan (#144): mapowane są tylko klasy secret (→ --set-secrets) i var
  // (→ --env-vars-file); vercel-only, build, image, platform, ci-only nigdy.
  it("tylko klasy secret i var trafiają do usługi; describe dokładnie dla sekretów z manifestu", () => {
    const manifest = JSON.parse(read("infra/gcp/env-manifest.json")) as { variables: Record<string, { class: string; secretName?: string }> };
    const secretNames = Object.values(manifest.variables).filter((v) => v.class === "secret").map((v) => v.secretName!).sort();
    const others = Object.entries(manifest.variables).filter(([, v]) => v.class !== "secret" && v.class !== "var").map(([k]) => k);
    const extra = Object.fromEntries(others.map((k) => [k, "x"]));
    const r = deploy(REQUIRED, { ...extra, ADMIN_EMAILS: "a@example.test", NODE_ENV: "test" });
    expect(r.status, r.stderr).toBe(0);
    expect([...r.described].sort()).toEqual(secretNames);
    const envNames = r.envFile.map((l) => l.split(":")[0]);
    expect(envNames).toContain("ADMIN_EMAILS");
    for (const k of others) {
      expect(envNames).not.toContain(k);
      expect(r.run).not.toContain(`${k}=`);
    }
  });

  it("vercel-only / build z nazwą sekretu w manifeście nie są mapowane (manifest testowy)", () => {
    const m = join(dir, "manifest-classes.json");
    writeFileSync(m, JSON.stringify({ variables: {
      A_SECRET: { class: "secret", secretName: "a-secret", required: true },
      VO_KEY: { class: "vercel-only", secretName: "vo-secret", required: true },
      B_KEY: { class: "build", secretName: "b-secret" },
      V_VAR: { class: "var" },
      VO_VAR: { class: "vercel-only" },
    } }));
    const r = deploy("a-secret=ENABLED,vo-secret=ENABLED,b-secret=ENABLED", { MANIFEST: m, V_VAR: "v", VO_VAR: "w" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.described).toEqual(["a-secret"]);
    expect(secretsArg(r.run!)).toEqual(["A_SECRET=a-secret:latest"]);
    expect(r.envFile).toEqual(['V_VAR: "v"']);
  });

  // Leo (#151 pkt 2): strażnik „no secrets to map” — osiągalny tylko bez
  // wymaganych sekretów w manifeście.
  it("żaden sekret do zmapowania → kod 2 przed gcloud run deploy", () => {
    const m = join(dir, "manifest-none.json");
    writeFileSync(m, JSON.stringify({ variables: { OPT_SECRET: { class: "secret", secretName: "opt-secret" } } }));
    const r = deploy("", { MANIFEST: m });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/error: no secrets to map/);
    expect(r.run).toBeUndefined();
  });

  // Ethan (#144): pusty wynik odczytu (kod 0) nie jest ENABLED; od K-1b = brak wersji.
  it("pusty stan wersji: wymagany → kod 2 przed deployem; opcjonalny → pominięty", () => {
    const req = deploy("postgres-url=EMPTY,better-auth-secret=ENABLED");
    expect(req.status).toBe(2);
    expect(req.stderr).toMatch(/required secrets without an enabled version: postgres-url/);
    expect(req.run).toBeUndefined();
    const opt = deploy(`${REQUIRED},cron-secret=EMPTY`);
    expect(opt.status, opt.stderr).toBe(0);
    expect(opt.stdout).toMatch(/skip: optional secret cron-secret has no enabled version \(MISSING\)/);
    expect(secretsArg(opt.run!).join(",")).not.toContain("cron-secret");
  });

  it("brak SQL_INSTANCE → kod 2 przed pierwszym gcloud", () => {
    const r = deploy(REQUIRED, { SQL_INSTANCE: "" });
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

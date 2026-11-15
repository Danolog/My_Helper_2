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
 * true; base_url → vars.NEXT_PUBLIC_APP_URL; BASE_URL z sekretu w workflow_call.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DEPLOY = read(".github/workflows/deploy-cloud-run.yml");
const E2E = read(".github/workflows/e2e-production.yml");
const RUN_DEPLOY = read("infra/gcp/run-deploy.sh");
const RUN_MIGRATE = read("infra/gcp/run-migrate.sh");
const MANIFEST = JSON.parse(read("infra/gcp/env-manifest.json")) as {
  variables: Record<string, { class: string; secretName?: string }>;
};

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

  it("permissions: id-token: write, contents: read", () => {
    expect(DEPLOY).toMatch(/^permissions:\n {2}id-token: write\n {2}contents: read\n/m);
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

  it("tryb Cloud Run odmawia pustego, nie-https albo Vercelowego URL, przed checkoutem", () => {
    const guard = E2E.indexOf("Cloud Run mode must not target Vercel");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(E2E.indexOf("actions/checkout"));
    const step = E2E.slice(guard, E2E.indexOf("\n\n", guard));
    expect(step).toContain("if: github.event_name != 'deployment_status'");
    expect(step).toContain('"$BASE_URL" == *vercel.app*');
    expect(step).toContain("exit 1");
  });

  it("deployment_status nadal tylko dla udanego Production", () => {
    expect(E2E).toContain(
      "github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'",
    );
  });
});

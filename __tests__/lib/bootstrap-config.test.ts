// @vitest-environment node
/**
 * Strażnik G-D1 (krok D, 0.3; #121): infra/gcp/bootstrap.sh.
 * Skrypt jest uruchamiany z podstawionym `gcloud` (zapisuje argumenty,
 * zawartość --flags-file i stdin), więc testy sprawdzają ZACHOWANIE, nie tekst:
 *  - domyślnie dry-run: zero wywołań gcloud w każdym etapie, także odczytów;
 *  - każde wywołanie idzie z --project i --quiet;
 *  - zero wartości sekretów: etap secrets tworzy puste kontenery (bez
 *    --data-file), hasła bazy nigdy nie są argumentem ani wyjściem;
 *  - zasobnik: allUsers wyłącznie roles/storage.legacyObjectReader (#118 pkt 5);
 *  - Cloud SQL: jawnie --edition=enterprise (koszt), ochrona przed usunięciem,
 *    zonal, kopie i PITR, ENCRYPTED_ONLY, bez autoryzowanych sieci (Ethan, 0.4);
 *  - secretAccessor osobno na każdy sekret, nigdy na projekcie; zero ról
 *    owner/editor; run.developer tylko na zasobach;
 *  - WIF: warunek z pliku, czysta koniunkcja równości (#140), z dziewięcioma
 *    obowiązkowymi członami (Ryan 6899923012);
 *  - region przypięty do europe-central2 we wszystkich `create` (Ethan);
 *  - hasło: błąd odczytu wersji sekretu przerywa etap, ścieżka samonaprawy
 *    (login istnieje, sekret bez wersji → set-password), wywołania haseł
 *    bez lokalnego logu gcloud (B-1);
 *  - bootstrap nigdy nie tworzy loginu bazy (login z Admin API dostaje
 *    cloudsqlsuperuser): brak loginu aplikacji albo dry-run → stop przed hasłem;
 *  - rola kopii: dokładnie trzy uprawnienia, warunek Instance + BackupRun (W-1);
 *  - idempotencja: istniejące zasoby nie są tworzone ponownie.
 * Mutacje (scratchpad, wynik w PR): usunąć --edition; edycja enterprise-plus;
 * objectViewer zamiast legacyObjectReader; usunąć --deletion-protection;
 * wykonywać w dry-run; przyjąć pusty warunek WIF; dopuścić `||`; hasło jako
 * --password=; wypisać hasło; secretAccessor na projekcie; --data-file w
 * etapie secrets; describe bez sprawdzania (brak idempotencji).
 */
import { spawn, spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/bootstrap.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "infra/gcp/env-manifest.json"), "utf8")) as {
  variables: Record<string, { class: string; secretName?: string }>;
};
const SECRET_NAMES = Object.values(MANIFEST.variables)
  .filter((v) => v.class === "secret")
  .map((v) => v.secretName!)
  .sort();

const PROJECT = "my-helper-2-488419";
const STAGES = ["apis", "ar", "bucket", "secrets", "sa", "sql", "run", "wif"] as const;
const VALID_CONDITION = [
  "# komentarz jest pomijany",
  "assertion.repository_id == '1152153440' &&",
  "assertion.repository_owner_id == '171363250' &&",
  "assertion.ref == 'refs/heads/main' &&",
  "assertion.workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main' &&",
  "assertion.job_workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml@refs/heads/main' &&",
  "assertion.environment == 'production-gcp' &&",
  "assertion.event_name == 'workflow_dispatch' &&",
  "assertion.run_attempt == '1' &&",
  "assertion.actor_id == '171363250'",
].join("\n");

const DIR = mkdtempSync(join(tmpdir(), "g-d1-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const FAKE = join(DIR, "bin");
spawnSync("mkdir", ["-p", FAKE]);
writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case " $* " in *" sql users "*) printf '%s\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING-unset}" >> "$FAKE_ENV" ;; esac
case " $* " in *" versions add "*) printf '%s\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING-unset}" >> "$FAKE_ENV_ADD" ;; esac
for a in "$@"; do
  case "$a" in
    --flags-file=*) cat "\${a#--flags-file=}" >> "$FAKE_FLAGS" ;;
    --data-file=-) cat >> "$FAKE_STDIN"; printf '\\n' >> "$FAKE_STDIN" ;;
  esac
done
case " $* " in
  *" secrets versions list "*)
    [ -n "$FAKE_VERSIONS_ERROR" ] && { echo "ERROR: PERMISSION_DENIED" >&2; exit 1; }
    [ -n "$FAKE_EXISTS" ] && echo "1"
    exit 0 ;;
  *" sql instances describe "*"--format=value(state)"*)
    echo "\${FAKE_SQL_STATE:-RUNNABLE}"; exit 0 ;;
  *" sql users describe "*)
    [ -n "$FAKE_USERS_MISSING" ] && exit 1; exit 0 ;;
esac
[ -n "$FAKE_EXISTS" ] && exit 0
case " $* " in *" describe "*) exit 1 ;; esac
exit 0
`,
);
chmodSync(join(FAKE, "gcloud"), 0o755);

let n = 0;
function cond(text: string): string {
  const p = join(DIR, `cond-${n++}.cel`);
  writeFileSync(p, text);
  return p;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
  flags: string;
  stdin: string;
  env: string[];
  /** CLOUDSDK_CORE_DISABLE_FILE_LOGGING przy każdym `secrets versions add`. */
  envAdd: string[];
}

interface Opts {
  exists?: boolean;
  /** Login aplikacji nie istnieje (`sql users describe` → kod 1). Domyślnie istnieje (stan produkcji). */
  usersMissing?: boolean;
  versionsError?: boolean;
  sqlState?: string;
}

function bootstrap(args: string[], opts: Opts = {}): Run {
  const id = n++;
  const log = join(DIR, `log-${id}`);
  const flags = join(DIR, `flags-${id}`);
  const stdin = join(DIR, `stdin-${id}`);
  const env = join(DIR, `env-${id}`);
  const envAdd = join(DIR, `env-add-${id}`);
  for (const f of [log, flags, stdin, env, envAdd]) writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${FAKE}:${process.env.PATH}`,
      FAKE_LOG: log,
      FAKE_FLAGS: flags,
      FAKE_STDIN: stdin,
      FAKE_ENV: env,
      FAKE_ENV_ADD: envAdd,
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
      ...(opts.usersMissing ? { FAKE_USERS_MISSING: "1" } : {}),
      ...(opts.versionsError ? { FAKE_VERSIONS_ERROR: "1" } : {}),
      ...(opts.sqlState ? { FAKE_SQL_STATE: opts.sqlState } : {}),
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls,
    flags: readFileSync(flags, "utf8"),
    stdin: readFileSync(stdin, "utf8"),
    env: readFileSync(env, "utf8").split("\n").filter(Boolean),
    envAdd: readFileSync(envAdd, "utf8").split("\n").filter(Boolean),
  };
}

const base = (stage: string, wif = cond(VALID_CONDITION)) => [
  `--project=${PROJECT}`,
  "--region=europe-central2",
  `--stage=${stage}`,
  "--bucket=myhelper-uploads-test",
  "--project-number=843777043748",
  `--wif-condition-file=${wif}`,
];

describe("G-D1: dry-run i parametry", () => {
  it.each(STAGES.filter((s) => s !== "sql"))("etap %s: domyślnie dry-run — zero wywołań gcloud, także odczytów", (stage) => {
    const r = bootstrap(base(stage));
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stdout).toContain(`stage ${stage}: done`);
  });

  // Dry-run nie sprawdza, czy login aplikacji istnieje — więc zatrzymuje się tak samo
  // jak przy braku loginu, zanim wypisze zmianę hasła tego loginu.
  it("etap sql: domyślnie dry-run — zero wywołań gcloud; stop na niesprawdzonym loginie aplikacji", () => {
    const r = bootstrap(base("sql"));
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stderr).toMatch(/login myhelper_svc not found .*docs\/runbook-krok-d\.md, section 3\.6/);
    expect(r.stdout).not.toMatch(/sql users create|set-password myhelper_svc|versions add postgres-url/);
    expect(r.stdout).not.toContain("stage sql: done");
  });

  it("jawne --dry-run po --apply wygrywa (ostatnie słowo) i nic nie wykonuje", () => {
    expect(bootstrap([...base("sql"), "--apply", "--dry-run"]).calls).toEqual([]);
  });

  it("wyjście dry-run to wyłącznie polecenia i odczyty stanu", () => {
    for (const stage of STAGES) {
      for (const line of bootstrap(base(stage)).stdout.split("\n").filter(Boolean)) {
        expect(line).toMatch(/^(mode: |\? gcloud |\+ gcloud |\+ CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud |  state: |  policy: |  condition: |  skip: |  GCP_[A-Z_]+=|stage [a-z]+: done$)/);
      }
    }
  });

  it.each([
    ["bez --project", ["--region=europe-central2", "--stage=apis"]],
    ["bez --region", [`--project=${PROJECT}`, "--stage=apis"]],
    ["bez --stage", [`--project=${PROJECT}`, "--region=europe-central2"]],
    ["nieznany etap", [`--project=${PROJECT}`, "--region=europe-central2", "--stage=all"]],
    ["nieznany argument", [...base("apis"), "--force"]],
    ["bucket bez --bucket", [`--project=${PROJECT}`, "--region=europe-central2", "--stage=bucket"]],
    ["wif bez pliku warunku", [`--project=${PROJECT}`, "--region=europe-central2", "--stage=wif", "--project-number=1"]],
    ["wif bez numeru projektu", [`--project=${PROJECT}`, "--region=europe-central2", "--stage=wif", `--wif-condition-file=${cond(VALID_CONDITION)}`]],
    ["nieprawidłowa nazwa instancji", [...base("sql"), "--sql-instance=Bad_Name"]],
    ["region spoza allowlisty", [...base("sql"), "--region=europe-west1"]],
    ["region us-central1", [...base("bucket"), "--region=us-central1"]],
  ])("%s → błąd przed pierwszym gcloud, także z --apply", (_label, args) => {
    const r = bootstrap([...args, "--apply"]);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it("każde tworzenie zasobu regionalnego idzie z europe-central2 (Ethan: region przypięty)", () => {
    const creates = STAGES.flatMap((s) => bootstrap([...base(s), "--apply"]).calls).filter((c) =>
      / (repositories create|buckets create|secrets create|instances create|run deploy|jobs create) /.test(c),
    );
    // ar, bucket, sekrety z manifestu + admin, instancja, usługa, job
    expect(creates.length).toBe(1 + 1 + SECRET_NAMES.length + 1 + 1 + 1 + 1);
    for (const c of creates) {
      expect(c).toMatch(/ --(region|location|locations)=europe-central2( |$)/);
      expect(c).not.toMatch(/ --(region|location|locations)=(?!europe-central2( |$))/);
    }
  });

  it("parametry instancji SQL nie są przełączalne z linii poleceń (decyzja Ethana)", () => {
    for (const flag of ["--sql-tier=db-custom-4-16384", "--pg-version=POSTGRES_16", "--db-user=root"]) {
      expect(bootstrap([...base("sql"), flag]).status).toBe(2);
    }
  });
});

describe("G-D1: każde wywołanie przez GC (--project, --quiet)", () => {
  it.each(STAGES)("etap %s z --apply", (stage) => {
    const r = bootstrap([...base(stage), "--apply"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) expect(c.startsWith(`--project=${PROJECT} --quiet `)).toBe(true);
  });

  it("w kodzie jedyne wywołanie gcloud to tablica GC (reszta to echo)", () => {
    const lines = SOURCE.split("\n").filter((l) => /\bgcloud\b/.test(l) && !l.trim().startsWith("#"));
    for (const l of lines) expect(l).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$|^\s*echo "[+?] (CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 )?gcloud /);
  });
});

describe("G-D1: apis, ar, bucket", () => {
  it("apis: dokładnie wymagane API (+ iam do kont, ról i WIF)", () => {
    const [call] = bootstrap([...base("apis"), "--apply"]).calls;
    const apis = call!.split(" ").slice(4).sort();
    expect(apis).toEqual(
      [
        "artifactregistry.googleapis.com",
        "cloudscheduler.googleapis.com",
        "iam.googleapis.com",
        "iamcredentials.googleapis.com",
        "run.googleapis.com",
        "secretmanager.googleapis.com",
        "sqladmin.googleapis.com",
        "sts.googleapis.com",
      ].sort(),
    );
  });

  it("ar: polityka czyszczenia zostawia 5 ostatnich i NIE jest w trybie --dry-run", () => {
    const r = bootstrap([...base("ar"), "--apply"]);
    const policy = r.calls.find((c) => c.includes("set-cleanup-policies"))!;
    expect(policy).toBeDefined();
    expect(policy).not.toContain("--dry-run");
    const line = r.stdout.split("\n").find((l) => l.startsWith("  policy: "))!;
    const rules = JSON.parse(line.slice("  policy: ".length)) as {
      action: { type: string };
      mostRecentVersions?: { keepCount: number };
      condition?: { tagState: string };
    }[];
    expect(rules).toHaveLength(2);
    expect(rules.filter((x) => x.action.type === "Keep").map((x) => x.mostRecentVersions?.keepCount)).toEqual([5]);
    expect(rules.filter((x) => x.action.type === "Delete").map((x) => x.condition?.tagState)).toEqual(["any"]);
  });

  it("bucket: uniform access, allUsers wyłącznie legacyObjectReader", () => {
    const r = bootstrap([...base("bucket"), "--apply"]);
    const create = r.calls.find((c) => c.includes("buckets create"))!;
    expect(create).toContain("--uniform-bucket-level-access");
    const pub = r.calls.filter((c) => c.includes("--member=allUsers"));
    expect(pub).toEqual([expect.stringContaining("--role=roles/storage.legacyObjectReader")]);
    expect(pub[0]).toContain("gs://myhelper-uploads-test");
    expect(SOURCE).not.toMatch(/objectViewer/);
  });
});

describe("G-D1: sekrety i konta", () => {
  it("secrets: puste kontenery dla wszystkich sekretów z manifestu, bez --data-file", () => {
    const r = bootstrap([...base("secrets"), "--apply"]);
    const creates = r.calls.filter((c) => c.includes("secrets create"));
    expect(creates.map((c) => c.split(" ")[4]).sort()).toEqual(SECRET_NAMES);
    expect(SECRET_NAMES).toEqual(expect.arrayContaining(["postgres-url", "better-auth-secret"]));
    for (const c of creates) {
      expect(c).not.toMatch(/--data-file/);
      expect(c).toContain("--replication-policy=user-managed --locations=europe-central2");
    }
    expect(r.calls.some((c) => c.includes("versions add"))).toBe(false);
    expect(r.stdin).toBe("");
  });

  it("sa: secretAccessor osobno na każdym sekrecie, nigdy na projekcie", () => {
    const r = bootstrap([...base("sa"), "--apply"]);
    const acc = r.calls.filter((c) => c.includes("roles/secretmanager.secretAccessor"));
    expect(acc.every((c) => c.includes("secrets add-iam-policy-binding"))).toBe(true);
    expect(acc.map((c) => c.split(" ")[4]).sort()).toEqual(SECRET_NAMES);
    expect(acc.every((c) => c.includes("serviceAccount:myhelper-runtime@"))).toBe(true);
  });

  it("sa: deploy czyta tylko metadane wersji (viewer) osobno na każdym sekrecie, nigdy secretAccessor", () => {
    const r = bootstrap([...base("sa"), "--apply"]);
    const deploy = r.calls.filter((c) => c.includes("serviceAccount:myhelper-deploy@") && c.includes("secrets add-iam-policy-binding"));
    expect(deploy.map((c) => c.split(" ")[4]).sort()).toEqual(SECRET_NAMES);
    for (const c of deploy) expect(c).toContain("--role=roles/secretmanager.viewer");
  });

  it("sa: deploy ma actAs tylko na koncie runtime i AR writer tylko na repo", () => {
    const r = bootstrap([...base("sa"), "--apply"]);
    const actAs = r.calls.filter((c) => c.includes("roles/iam.serviceAccountUser"));
    expect(actAs).toEqual([expect.stringMatching(/service-accounts add-iam-policy-binding myhelper-runtime@/)]);
    const ar = r.calls.filter((c) => c.includes("roles/artifactregistry.writer"));
    expect(ar).toEqual([expect.stringContaining("artifacts repositories add-iam-policy-binding myhelper ")]);
  });

  it("żaden etap nie nadaje ról pierwotnych ani administracyjnych", () => {
    for (const stage of STAGES) {
      for (const c of bootstrap([...base(stage), "--apply"]).calls) {
        expect(c).not.toMatch(/roles\/(owner|editor|viewer|[a-z]+\.admin)\b/);
      }
    }
  });

  it("na projekcie wiązania tylko cloudsql.client i własna rola kopii — z warunkiem na instancję", () => {
    for (const stage of STAGES) {
      for (const c of bootstrap([...base(stage), "--apply"]).calls.filter((c) => c.includes("projects add-iam-policy-binding"))) {
        expect(c).toMatch(/--role=(roles\/cloudsql\.client|projects\/my-helper-2-488419\/roles\/myhelperSqlBackup) /);
        expect(c).toContain('resource.name == "projects/my-helper-2-488419/instances/myhelper-pg"');
        expect(c).not.toMatch(/resource\.name\.startsWith\("projects\/my-helper-2-488419\/instances\/myhelper-pg"\)/);
      }
    }
  });
});

describe("G-D1: Cloud SQL (Ethan, 0.4)", () => {
  const r = bootstrap([...base("sql"), "--apply"]);
  const create = r.calls.find((c) => c.includes("sql instances create"))!;

  it("instancja: jawnie enterprise, POSTGRES_18, db-f1-micro, zonal", () => {
    expect(create).toBeDefined();
    expect(create).toMatch(/ --edition=enterprise /);
    expect(create).not.toMatch(/enterprise-plus|ENTERPRISE_PLUS/i);
    expect(create).toContain("--database-version=POSTGRES_18");
    expect(create).toContain("--tier=db-f1-micro");
    expect(create).toContain("--availability-type=zonal");
    expect(SOURCE).toMatch(/^SQL_EDITION="enterprise"$/m);
    expect(SOURCE).toMatch(/^SQL_TIER="db-f1-micro"$/m);
    // Strażnik kosztowy przed jakimkolwiek wywołaniem w etapie sql.
    expect(SOURCE).toMatch(/\[\[ "\$SQL_EDITION" == "enterprise" \]\] \|\| die/);
    expect(SOURCE).toMatch(/\[\[ "\$SQL_TIER" == "db-f1-micro" \]\] \|\| die/);
  });

  it("instancja: ochrona przed usunięciem, kopie 7 + PITR 7 dni, okno SUN 03, dysk 10→30 GB", () => {
    for (const f of [
      "--deletion-protection",
      "--backup-start-time=01:00",
      "--retained-backups-count=7",
      "--enable-point-in-time-recovery",
      "--retained-transaction-log-days=7",
      "--maintenance-window-day=SUN",
      "--maintenance-window-hour=3",
      "--storage-type=SSD",
      "--storage-size=10GB",
      "--storage-auto-increase",
      "--storage-auto-increase-limit=30",
    ]) {
      expect(create.split(" ")).toContain(f);
    }
  });

  // Lokalizacja kopii: bez flagi kopie lądują w domyślnej lokalizacji wielu regionów (UE),
  // a umowa powierzenia mówi o europe-central2. Flaga dokładnie raz, wartość = region.
  it("instancja: kopie zapasowe w regionie — --backup-location=europe-central2 dokładnie raz", () => {
    const parts = create.split(" ");
    expect(parts.filter((p) => p.startsWith("--backup-location"))).toEqual(["--backup-location=europe-central2"]);
    const region = parts.find((p) => p.startsWith("--region="))!.slice("--region=".length);
    expect(parts).toContain(`--backup-location=${region}`);
    expect(r.calls.filter((c) => c.includes("--backup-location")).length).toBe(1);
  });

  it("instancja: tylko szyfrowane połączenia, bez autoryzowanych sieci", () => {
    expect(create).toContain("--ssl-mode=ENCRYPTED_ONLY");
    expect(r.calls.join("\n")).not.toMatch(/authorized-networks|--no-assign-ip|0\.0\.0\.0/);
  });

  it("hasła: nigdy w argumentach ani w wyjściu; tylko --flags-file i stdin", () => {
    const pw = [...r.flags.matchAll(/^--password: "([A-Za-z0-9]{32})"$/gm)].map((m) => m[1]!);
    expect(pw).toHaveLength(2);
    expect(pw[0]).not.toBe(pw[1]);
    for (const p of pw) {
      expect(r.calls.join("\n")).not.toContain(p);
      expect(r.stdout + r.stderr).not.toContain(p);
    }
    expect(r.calls.join("\n")).not.toMatch(/--password[= ]/);
    const users = r.calls.filter((c) => /sql users (create|set-password)/.test(c));
    expect(users).toEqual([
      expect.stringMatching(/sql users set-password postgres --instance=myhelper-pg --flags-file=\S+$/),
      expect.stringMatching(/sql users set-password myhelper_svc --instance=myhelper-pg --flags-file=\S+$/),
    ]);
    // stdin: najpierw samo hasło postgres (potrzebne do utworzenia loginu aplikacji SQL-em
    // na nowej instancji), potem postgres-url — oba z wygenerowanych haseł.
    const [admin, url] = r.stdin.split("\n");
    expect(admin).toBe(pw[0]);
    expect(url).toBe(
      `postgresql://myhelper_svc:${pw[1]}@localhost/myhelper?host=/cloudsql/${PROJECT}:europe-central2:myhelper-pg`,
    );
    expect(url).not.toMatch(/sslmode/);
    const adds = r.calls.filter((c) => c.includes("versions add"));
    expect(adds.map((c) => c.split(" ")[5])).toEqual(["postgres-admin-password", "postgres-url"]);
    for (const c of adds) expect(c).toMatch(/ --data-file=-$/);
  });

  it("login aplikacji to myhelper_svc; bootstrap nie tworzy ani loginów, ani ról NOLOGIN, ani SQL (to robią `postgres` i migracje)", () => {
    expect(SOURCE).toMatch(/^DB_USER="myhelper_svc"$/m);
    expect(SOURCE).not.toMatch(/myhelper_owner/);
    // Login z Cloud SQL Admin API dostaje cloudsqlsuperuser — gałęzi tworzenia loginu nie ma wcale.
    expect(SOURCE).not.toMatch(/sql users create/);
    expect(SOURCE).not.toMatch(/verb="create"/);
    expect(r.calls.join("\n")).not.toMatch(/sql users create/);
    const code = SOURCE.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).not.toMatch(/myhelper_app|NOLOGIN|CREATE ROLE|\bpsql\b|sql connect/i);
    expect(r.calls.join("\n")).not.toMatch(/myhelper_app|sql connect|psql/);
  });

  it("hasło postgres trafia do osobnego sekretu spoza manifestu — w ŻADNYM etapie bez wiązań IAM", () => {
    expect(SECRET_NAMES).not.toContain("postgres-admin-password");
    for (const stage of STAGES) {
      for (const exists of [false, true]) {
        const calls = bootstrap([...base(stage), "--apply"], { exists }).calls;
        expect(calls.filter((c) => c.includes("postgres-admin-password") && c.includes("iam-policy"))).toEqual([]);
      }
    }
  });

  it("B-1: wywołania z hasłem (sql users create|set-password) bez lokalnego logu gcloud", () => {
    const users = r.calls.filter((c) => /sql users (create|set-password)/.test(c));
    expect(users).toHaveLength(2);
    // Fałszywy gcloud zapisuje zmienną przy każdym `sql users …` (describe też).
    const all = r.calls.filter((c) => / sql users /.test(c));
    const envAt = all.map((c, i) => [c, r.env[i]] as const).filter(([c]) => /sql users (create|set-password)/.test(c));
    expect(envAt.map(([, e]) => e)).toEqual(["1", "1"]);
    expect(SOURCE).toMatch(/CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "\$\{GC\[@\]\}" sql users/);
  });

  // N2 (Ryan, K-1b): `secrets versions add` z hasłem w stdin też bez lokalnego logu gcloud.
  it("N2: każde secrets versions add (postgres-url, postgres-admin-password) bez lokalnego logu gcloud", () => {
    const adds = r.calls.filter((c) => c.includes("versions add"));
    expect(adds).toHaveLength(2);
    expect(r.envAdd).toEqual(["1", "1"]);
    expect(SOURCE).toMatch(/CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 "\$\{GC\[@\]\}" secrets versions add/);
  });

  it("błąd odczytu wersji sekretu (≠ brak wersji) przerywa etap przed hasłem", () => {
    const e = bootstrap([...base("sql"), "--apply"], { versionsError: true });
    expect(e.status).toBe(2);
    expect(e.stderr).toMatch(/cannot read versions of secret postgres-admin-password/);
    expect(e.calls.filter((c) => /sql users (create|set-password)|versions add/.test(c))).toEqual([]);
    expect(e.flags + e.stdin).toBe("");
  });

  it("samonaprawa: login istnieje, sekret bez wersji → set-password myhelper_svc (nie create) i wersja URL z myhelper_svc", () => {
    const h = bootstrap([...base("sql"), "--apply"]);
    expect(h.status, h.stderr).toBe(0);
    expect(h.calls).toContain(`--project=${PROJECT} --quiet sql users describe myhelper_svc --instance=myhelper-pg`);
    const users = h.calls.filter((c) => /sql users (create|set-password)/.test(c));
    expect(users).toEqual([
      expect.stringMatching(/sql users set-password postgres --instance=myhelper-pg --flags-file=\S+$/),
      expect.stringMatching(/sql users set-password myhelper_svc --instance=myhelper-pg --flags-file=\S+$/),
    ]);
    expect(h.calls.filter((c) => c.includes("versions add")).map((c) => c.split(" ")[5])).toEqual([
      "postgres-admin-password",
      "postgres-url",
    ]);
    expect(h.stdin.split("\n")[1]).toMatch(/^postgresql:\/\/myhelper_svc:[A-Za-z0-9]{32}@localhost\/myhelper\?host=\/cloudsql\//);
  });

  it("brak loginu aplikacji → stop (kod 2) ze wskazaniem sekcji 3.6; zero create, zero set-password i wersji postgres-url dla myhelper_svc", () => {
    const m = bootstrap([...base("sql"), "--apply"], { usersMissing: true });
    expect(m.status).toBe(2);
    expect(m.stderr).toMatch(/login myhelper_svc not found on instance myhelper-pg/);
    expect(m.stderr).toMatch(/created with SQL by postgres \(docs\/runbook-krok-d\.md, section 3\.6\)/);
    expect(m.calls.filter((c) => /sql users create/.test(c))).toEqual([]);
    expect(m.calls.filter((c) => /sql users set-password myhelper_svc|versions add postgres-url/.test(c))).toEqual([]);
    expect(m.stdout).not.toMatch(/sql users create|set-password myhelper_svc|versions add postgres-url/);
    // Jedyne hasło w tym przebiegu to `postgres` (ustawiane przed loginem aplikacji); żadnego URL.
    expect(m.flags.match(/^--password: /gm)).toHaveLength(1);
    expect(m.stdin).not.toMatch(/postgresql:\/\//);
    // Ostatnie wywołanie to sprawdzenie loginu — dalej nic (ani hasło aplikacji, ani wiązania).
    expect(m.calls[m.calls.length - 1]).toBe(`--project=${PROJECT} --quiet sql users describe myhelper_svc --instance=myhelper-pg`);
    expect(m.stdout).not.toContain("stage sql: done");
  });

  it("login aplikacji nie istnieje, ale postgres-url ma wersję → pominięty bez sprawdzania loginu (hasło bez zmian)", () => {
    const s = bootstrap([...base("sql"), "--apply"], { exists: true, usersMissing: true });
    expect(s.status, s.stderr).toBe(0);
    expect(s.stdout).toContain("skip: postgres-url has a version (password of myhelper_svc unchanged)");
    expect(s.calls.filter((c) => / sql users /.test(c))).toEqual([]);
  });

  // `value(state)` w gcloud potrafi wypisać enum małymi literami (secrets: `enabled`).
  it("stan instancji małymi literami (`runnable`) → etap idzie dalej; `pending_create` przerywa", () => {
    const low = bootstrap([...base("sql"), "--apply"], { sqlState: "runnable" });
    expect(low.status, low.stderr).toBe(0);
    expect(low.calls.some((c) => c.includes("sql databases create"))).toBe(true);
    const pending = bootstrap([...base("sql"), "--apply"], { sqlState: "pending_create" });
    expect(pending.status).toBe(2);
    expect(pending.stderr).toMatch(/PENDING_CREATE, not RUNNABLE/);
  });

  it("baza i loginy dopiero na instancji RUNNABLE; inny stan przerywa etap", () => {
    const p = bootstrap([...base("sql"), "--apply"], { sqlState: "PENDING_CREATE" });
    expect(p.status).toBe(2);
    expect(p.stderr).toMatch(/PENDING_CREATE, not RUNNABLE/);
    const after = p.calls.findIndex((c) => c.includes("--format=value(state)"));
    expect(after).toBeGreaterThan(-1);
    expect(p.calls.slice(after + 1)).toEqual([]);
    const ok = r.calls.findIndex((c) => c.includes("--format=value(state)"));
    expect(ok).toBeGreaterThan(r.calls.findIndex((c) => c.includes("sql instances create")));
    expect(ok).toBeLessThan(r.calls.findIndex((c) => c.includes("sql databases create")));
  });

  it("dry-run sql nie generuje hasła i nie wypisuje zmiany hasła (stop na niesprawdzonym loginie)", () => {
    const d = bootstrap(base("sql"));
    expect(d.status).toBe(2);
    expect(d.stdout).toContain(`? gcloud --project=${PROJECT} --quiet sql users describe myhelper_svc --instance=myhelper-pg`);
    expect(d.stdout).toContain("--flags-file=<(--password: <generated>)");
    expect(d.stdout).not.toMatch(/set-password myhelper_svc|versions add postgres-url/);
    expect(d.stdout).not.toMatch(/[A-Za-z0-9]{32}/);
    expect(d.flags + d.stdin).toBe("");
  });

  it("cloudsql.client tylko dla runtime (usługa i job migracji), z warunkiem na instancję; deploy bez", () => {
    const client = r.calls.filter((c) => c.includes("roles/cloudsql.client"));
    expect(client.map((c) => c.match(/serviceAccount:([a-z-]+)@/)![1])).toEqual(["myhelper-runtime"]);
    expect(client[0]).toMatch(
      / --condition=expression=resource\.type == "sqladmin\.googleapis\.com\/Instance" && resource\.name == "projects\/my-helper-2-488419\/instances\/myhelper-pg",title=only-myhelper-pg$/,
    );
  });

  it("W-1: rola kopii ma DOKŁADNIE backupRuns.create, backupRuns.get, instances.get (bez list)", () => {
    for (const exists of [false, true]) {
      const x = exists ? bootstrap([...base("sql"), "--apply"], { exists: true }) : r;
      const role = x.calls.filter((c) => / iam roles (create|update) myhelperSqlBackup /.test(c));
      expect(role).toHaveLength(1);
      const perms = role[0]!.match(/ --permissions=(\S+)/)![1]!.split(",").sort();
      expect(perms).toEqual(["cloudsql.backupRuns.create", "cloudsql.backupRuns.get", "cloudsql.instances.get"]);
    }
  });

  // Treść warunku = wiązanie już ustawione w GCP (inna treść → drugie wiązanie przy
  // ponownym bootstrapie). BackupRun jest oceniany z resource.name samej instancji
  // (bez ukośnika na końcu, log audytu) — stary warunek `startsWith(".../myhelper-pg/")`
  // dawał 403 na `cloudsql.backupRuns.create`.
  it("W-1: wiązanie roli kopii dla deploy z warunkiem Instance + BackupRun tej instancji", () => {
    const b = r.calls.filter((c) => c.includes("roles/myhelperSqlBackup"));
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("--member=serviceAccount:myhelper-deploy@");
    const condition = b[0]!.split(" --condition=")[1];
    expect(condition).toBe(
      'expression=(resource.type == "sqladmin.googleapis.com/Instance" || resource.type == "sqladmin.googleapis.com/BackupRun") && ' +
        '(resource.name == "projects/my-helper-2-488419/instances/myhelper-pg" || ' +
        'resource.name.startsWith("projects/my-helper-2-488419/instances/myhelper-pg/")),' +
        "title=only-myhelper-pg-backups",
    );
  });

  it("W-1: warunek kopii wpuszcza BackupRun o nazwie samej instancji, nie wpuszcza myhelper-pg2", () => {
    const condition = r.calls.find((c) => c.includes("roles/myhelperSqlBackup"))!.split(" --condition=expression=")[1]!;
    const expr = condition.slice(0, condition.lastIndexOf(",title="));
    // Mały ewaluator CEL dla tej jednej postaci: (typ == A || typ == B) && (nazwa == N || nazwa.startsWith(P)).
    const m = expr.match(
      /^\(resource\.type == "([^"]+)" \|\| resource\.type == "([^"]+)"\) && \(resource\.name == "([^"]+)" \|\| resource\.name\.startsWith\("([^"]+)"\)\)$/,
    );
    expect(m, expr).not.toBeNull();
    const [, typeA, typeB, exact, prefix] = m!;
    const allows = (type: string, name: string) => (type === typeA || type === typeB) && (name === exact || name.startsWith(prefix!));
    const inst = "projects/my-helper-2-488419/instances/myhelper-pg";
    expect(allows("sqladmin.googleapis.com/BackupRun", inst)).toBe(true);
    expect(allows("sqladmin.googleapis.com/BackupRun", `${inst}/backupRuns/123`)).toBe(true);
    expect(allows("sqladmin.googleapis.com/Instance", inst)).toBe(true);
    expect(allows("sqladmin.googleapis.com/BackupRun", `${inst}2`)).toBe(false);
    expect(allows("sqladmin.googleapis.com/Instance", `${inst}2`)).toBe(false);
    expect(allows("sqladmin.googleapis.com/Database", inst)).toBe(false);
  });

  it("idempotencja: istniejąca instancja, baza i wersje sekretów — nic nie jest tworzone ani zmieniane", () => {
    const again = bootstrap([...base("sql"), "--apply"], { exists: true });
    expect(again.status).toBe(0);
    expect(again.calls.filter((c) => / (create|set-password|versions add) /.test(` ${c} `))).toEqual([]);
    expect(again.flags + again.stdin).toBe("");
  });
});

describe("G-D1: run i idempotencja pozostałych etapów", () => {
  it("run: zastępcza rewizja = próbka Google hello, min 0 / max 1, bez sekretów i zmiennych", () => {
    const r = bootstrap([...base("run"), "--apply"]);
    const creates = r.calls.filter((c) => / run (deploy|jobs create) /.test(c));
    expect(creates).toHaveLength(2);
    for (const c of creates) {
      expect(c).toContain("--image=us-docker.pkg.dev/cloudrun/container/hello ");
      expect(c).toContain("--service-account=myhelper-runtime@");
      expect(c).not.toMatch(/--(set|update)-(secrets|env-vars)|--env-vars-file|--add-cloudsql/);
    }
    const svc = creates.find((c) => c.includes(" run deploy "))!;
    expect(svc.split(" ")).toEqual(expect.arrayContaining(["--min-instances=0", "--max-instances=1", "--no-allow-unauthenticated"]));
  });

  it("konto deploy nigdy nie dostaje ról zarządzania IAM ani run.admin", () => {
    for (const stage of STAGES) {
      for (const c of bootstrap([...base(stage), "--apply"]).calls.filter((c) => c.includes("serviceAccount:myhelper-deploy@"))) {
        expect(c).not.toMatch(/roles\/(run\.admin|resourcemanager\.[a-zA-Z]+|iam\.securityAdmin|iam\.roleAdmin|iam\.serviceAccountAdmin|owner|editor)\b/);
      }
    }
  });

  it("run: run.developer tylko na usłudze i jobie, publiczny invoker tylko na usłudze", () => {
    const r = bootstrap([...base("run"), "--apply"]);
    const dev = r.calls.filter((c) => c.includes("roles/run.developer"));
    expect(dev).toEqual([
      expect.stringContaining("run services add-iam-policy-binding myhelper "),
      expect.stringContaining("run jobs add-iam-policy-binding myhelper-migrate "),
    ]);
    const inv = r.calls.filter((c) => c.includes("roles/run.invoker"));
    expect(inv).toEqual([expect.stringMatching(/run services add-iam-policy-binding myhelper .*--member=allUsers/)]);
  });

  it.each(STAGES)("etap %s: gdy zasoby istnieją, nic nie jest tworzone", (stage) => {
    const r = bootstrap([...base(stage), "--apply"], { exists: true });
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => / (create|create-oidc|deploy) /.test(` ${c} `))).toEqual([]);
  });
});

describe("G-D1: WIF", () => {
  it("poprawny warunek: provider z warunkiem, workloadIdentityUser tylko dla repo po id", () => {
    const r = bootstrap([...base("wif"), "--apply"]);
    const prov = r.calls.find((c) => c.includes("providers create-oidc"))!;
    expect(prov).toContain("--issuer-uri=https://token.actions.githubusercontent.com");
    for (const clause of VALID_CONDITION.split("\n").slice(1)) {
      expect(prov).toContain(clause.replace(/ &&$/, ""));
    }
    expect(prov).not.toContain("komentarz");
    const wiu = r.calls.filter((c) => c.includes("roles/iam.workloadIdentityUser"));
    expect(wiu).toEqual([
      expect.stringContaining(
        "--member=principalSet://iam.googleapis.com/projects/843777043748/locations/global/workloadIdentityPools/github/attribute.repository_id/1152153440",
      ),
    ]);
  });

  it("dodatkowa równość (zawężenie) i inny podział na linie są przyjmowane", () => {
    const extra = `${VALID_CONDITION.replace(/ &&\n/g, " && ")} &&\n  assertion.repository_visibility == 'public'`;
    const r = bootstrap([...base("wif", cond(extra)), "--apply"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.find((c) => c.includes("providers create-oidc"))).toContain("assertion.repository_visibility == 'public'");
  });

  it("istniejący provider: update-oidc (warunek zawsze aktualizowany)", () => {
    const r = bootstrap([...base("wif"), "--apply"], { exists: true });
    expect(r.calls.some((c) => c.includes("providers update-oidc"))).toBe(true);
  });

  const broken: [string, string][] = [
    ["pusty plik", ""],
    ["same komentarze", "# nic\n# tu nie ma"],
    ["bez repository_id", VALID_CONDITION.replace("assertion.repository_id == '1152153440' &&", "")],
    ["bez repository_owner_id", VALID_CONDITION.replace("assertion.repository_owner_id == '171363250' &&", "")],
    ["bez ref main", VALID_CONDITION.replace("assertion.ref == 'refs/heads/main' &&", "")],
    ["inny workflow", VALID_CONDITION.replace("deploy-cloud-run.yml", "pr.yml")],
    ["bez event_name", VALID_CONDITION.replace("assertion.event_name == 'workflow_dispatch' &&", "")],
    ["bez run_attempt", VALID_CONDITION.replace("assertion.run_attempt == '1' &&", "")],
    ["bez job_workflow_ref", VALID_CONDITION.replace(/assertion\.job_workflow_ref == '[^']+' &&\n/, "")],
    ["inny job_workflow_ref", VALID_CONDITION.replace("job_workflow_ref == 'Danolog/My_Helper_2/.github/workflows/deploy-cloud-run.yml", "job_workflow_ref == 'Danolog/My_Helper_2/.github/workflows/pr.yml")],
    ["bez environment", VALID_CONDITION.replace("assertion.environment == 'production-gcp' &&", "")],
    ["inne environment", VALID_CONDITION.replace("'production-gcp'", "'staging'")],
    ["bez actor_id", VALID_CONDITION.replace(" &&\nassertion.actor_id == '171363250'", "")],
    ["inny actor_id", VALID_CONDITION.replace("actor_id == '171363250'", "actor_id == '1'")],
    ["alternatywa ||", `${VALID_CONDITION} || true`],
    ["alternatywa || w środku", VALID_CONDITION.replace("assertion.ref == 'refs/heads/main' &&", "assertion.ref == 'refs/heads/main' || assertion.ref == 'refs/heads/dev' &&")],
    ["negacja całości", `!(${VALID_CONDITION})`],
    ["negacja bez nawiasu (dodatkowy człon)", `${VALID_CONDITION} && !assertion.repository_visibility == 'private'`],
    ["negacja bez nawiasu (człon obowiązkowy)", VALID_CONDITION.replace("assertion.ref == 'refs/heads/main'", "!assertion.ref == 'refs/heads/main'")],
    ["negacja członu", VALID_CONDITION.replace("assertion.run_attempt == '1'", "!(assertion.run_attempt == '2')")],
    ["nierówność", VALID_CONDITION.replace("assertion.actor_id == '171363250'", "assertion.actor_id == '171363250' && assertion.sub != 'x'")],
    ["operator warunkowy", `${VALID_CONDITION.replace(" &&\nassertion.actor_id == '171363250'", "")} && (assertion.actor_id == '171363250' ? true : true)`],
    ["operator warunkowy na całości", `true ? true : (${VALID_CONDITION})`],
    ["człon w nawiasie z alternatywą", VALID_CONDITION.replace("assertion.ref == 'refs/heads/main'", "(assertion.ref == 'refs/heads/main' || true)")],
    ["funkcja zamiast równości", VALID_CONDITION.replace("assertion.ref == 'refs/heads/main'", "assertion.ref.startsWith('refs/heads/')")],
    ["wartość z podciągiem obowiązkowej", VALID_CONDITION.replace("'refs/heads/main'", "'refs/heads/main-x'")],
    ["&& bez spacji (nie da się rozdzielić członów)", VALID_CONDITION.replace(/ &&\n/g, "&&")],
  ];
  it.each(broken)("%s → odrzucony przed jakimkolwiek wywołaniem, także w dry-run", (_label, text) => {
    for (const mode of [[], ["--apply"]]) {
      const r = bootstrap([...base("wif", cond(text)), ...mode]);
      expect(r.status).toBe(2);
      expect(r.calls).toEqual([]);
    }
  });
});

// N2 (Ryan, K-1b): runbook D-5 — wartości sekretów wyłącznie przez stdin,
// przez tr -d '\r\n' i bez lokalnego logu gcloud (jedna funkcja add).
describe("G-D1: runbook D-5 — wartości sekretów tylko przez stdin (N2)", () => {
  const RUNBOOK = readFileSync(join(ROOT, "docs/runbook-krok-d.md"), "utf8");
  const d5 = RUNBOOK.slice(RUNBOOK.indexOf("## 5. D-5"), RUNBOOK.indexOf("## 6. D-6"));
  const block = d5.slice(d5.indexOf("```bash"), d5.indexOf("```", d5.indexOf("```bash") + 3));
  const lines = block.split("\n");

  // --- Statyka bloku D-5 -------------------------------------------------------------------
  const ADD_LINE = `add() { local v; v="$(tr -d '\\r\\n')"; [ -n "$v" ] || { echo "error: empty value for $1 — gcloud not called" >&2; return 1; }; printf '%s' "$v" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }`;
  const ADD_MULTILINE_LINE = `add_multiline() { local v; v="$(cat; printf x)"; v="\${v%x}"; [ -n "$v" ] || { echo "error: empty value for $1 — gcloud not called" >&2; return 1; }; printf '%s' "$v" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }`;

  it("funkcje add i add_multiline: pusta wartość → kod 1 bez gcloud; wartość przez wbudowany printf na stdin gcloud bez logu plikowego (K-1d B1)", () => {
    expect(block).toContain(ADD_LINE);
    expect(block).toContain(ADD_MULTILINE_LINE);
    const fn = lines.find((l) => l.startsWith("add_multiline() {"))!;
    expect(fn).not.toMatch(/\btr\b/);
    expect(d5).not.toMatch(/mktemp/);
  });

  it("blok D-5 zaczyna się od `set +x; set -o pipefail` (K-1d B1, Ethan N1)", () => {
    expect(lines.find((l) => l.trim() !== "" && !l.startsWith("```"))).toBe("set +x; set -o pipefail");
  });

  it("jedyne `secrets versions add` to funkcje add i add_multiline; żadnego --data-file=ŚCIEŻKA ani starego tr -d '\\n'", () => {
    const adds = lines.filter((l) => l.includes("secrets versions add"));
    expect(adds).toHaveLength(2);
    expect(adds[0]).toMatch(/^add\(\) \{/);
    expect(adds[1]).toMatch(/^add_multiline\(\) \{/);
    expect(block).not.toMatch(/--data-file=(?!-)/);
    expect(block).not.toContain("tr -d '\\n'");
  });

  // K-1d (Ryan): w D-5 żadnego zapisu wartości na dysk (TMPDIR, plik z kluczem, tee),
  // żadnego pobierania z npm bez wersji (npx), a rm oryginału tylko po udanym add (&&).
  it("D-5: bez zapisu do $TMPDIR ani do pliku, bez npx; rm oryginału wyłącznie po `&&` udanego add", () => {
    expect(d5).not.toMatch(/TMPDIR/);
    expect(d5).not.toMatch(/vapid\.json/);
    expect(d5).not.toMatch(/\bnpx\b/);
    expect(d5).not.toMatch(/\btee\b/);
    // Przekierowanie wyjścia do pliku: `>`/`>>` niepoprzedzone cyfrą deskryptora ani `&`, nie `>(…)` ani `>&N`.
    for (const l of lines) expect(l, l).not.toMatch(/(^|[^0-9&>])>>?\s*(?![(&])\S/);
    const rms = lines.filter((l) => /\brm\b/.test(l));
    expect(rms.length).toBeGreaterThanOrEqual(2);
    for (const l of rms) expect(l, l).toMatch(/^add [a-z-]+ < ("[^"]+") && rm \1$/);
  });

  it("D-5: uwagi w prozie — katalog repo, bash albo zsh, bez `set -x`, brak komentarzy w bloku (zsh bez interactivecomments)", () => {
    expect(d5).toContain("z katalogu repo");
    expect(d5).toContain("w **bash albo zsh**");
    expect(d5).toMatch(/\*\*bez\s+`set -x`\*\*/);
    expect(d5).toMatch(/interactivecomments/);
    expect(d5).toMatch(/komentarz wykonuje\s+się jako polecenie/);
    expect(d5).toMatch(/`resend-api-key`, `smsapi-token`, `upstash-redis-rest-token`, `google-client-secret`/);
    expect(d5).toContain('`add_multiline NAZWA < "$HOME/secure/NAZWA.pem"`');
  });

  const vapidAt = lines.findIndex((l) => l.startsWith("node -e") && l.includes("generateVAPIDKeys"));
  const VAPID = lines.slice(vapidAt, vapidAt + 4).join("\n");
  const PRELUDE = block.slice(block.indexOf("\n") + 1, block.indexOf("\nopenssl rand") + 1);
  const BODY = block.slice(block.indexOf("\n") + 1);

  it("D-5 VAPID: jedno wywołanie node z web-push z repo; prywatny ze stdout do add, publiczny przez deskryptor 3 do gh; potem vapid_check i metadane", () => {
    expect(vapidAt).toBeGreaterThanOrEqual(0);
    expect(lines.filter((l) => /generateVAPIDKeys|web-push/.test(l))).toHaveLength(1);
    expect(lines[vapidAt]).toContain('require("web-push").generateVAPIDKeys()');
    expect(lines[vapidAt + 1]).toBe("  3> >(gh variable set NEXT_PUBLIC_VAPID_PUBLIC_KEY --env production-gcp) \\");
    expect(lines[vapidAt + 2]).toBe("  | add vapid-private-key");
    expect(lines[vapidAt + 3]).toBe("vapid_check");
    expect(lines[vapidAt + 4]).toBe(
      "gcloud --project=$P secrets versions list vapid-private-key --sort-by=~createTime --limit=1 --format='value(name,state,createTime)'",
    );
    expect(lines.some((l) => /^gh variable get/.test(l))).toBe(false);
  });

  it("vapid_check: jedyny odczyt wartości (versions access) idzie potokiem do node; w zmiennej tylko klucz publiczny; reguła „powtórz cały blok”", () => {
    const access = lines.filter((l) => l.includes("versions access"));
    expect(access).toHaveLength(1);
    expect(access[0]).toMatch(
      /^ {4}sm="\$\(CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=\$P secrets versions access latest --secret=vapid-private-key \| node -e '[^']*createECDH\("prime256v1"\)[^']*getPublicKey\(\)[^']*'\)" \|\| sm=""$/,
    );
    expect(d5).toContain("powtarza się CAŁY blok VAPID");
    expect(d5).toContain("D-6 (wdrożenie) dopiero po „VAPID: para OK”");
  });

  // --- Wykonanie z fałszywymi gcloud i gh -------------------------------------------------------
  // gcloud: versions add → stdin do $REC/sm (FAKE_ADD_RC ≠ 0: odrzuca; FAKE_HANG=1: po zapisie znacznik
  //         $REC/hang wbudowanym `:` i exec sleep — wisi jako jeden proces, bez potomka do przeoczenia);
  //         versions access → $REC/sm albo błąd; versions list → metadane. argv i zmienna logu do $REC.
  // gh: variable set → stdin do $REC/ghvar (FAKE_GH_SET_RC ≠ 0: odrzuca); variable get → kolejna linia
  //     z $REC/gh.seq (stara wartość przy pierwszej próbie), potem $REC/ghvar. sleep: tylko licznik.
  const SHELLS = ["bash", ...(existsSync("/bin/zsh") ? ["/bin/zsh"] : [])];
  const world = () => {
    const root = join(DIR, `w-${n++}`);
    const bin = join(root, "bin");
    const tmp = join(root, "tmp");
    const home = join(root, "home");
    const rec = join(root, "rec");
    for (const d of [bin, tmp, home, rec]) mkdirSync(d, { recursive: true });
    const sh = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
      chmodSync(join(bin, name), 0o755);
    };
    sh(
      "gcloud",
      `for a in "$@"; do printf '%s\\n' "$a"; done >> "$REC/gcloud.argv"
printf '%s\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING-unset}" >> "$REC/gcloud.env"
case " $* " in
  *" versions add "*)
    if [ "\${FAKE_ADD_RC:-0}" != 0 ]; then cat > /dev/null; exit "$FAKE_ADD_RC"; fi
    cat > "$REC/sm.part"; mv "$REC/sm.part" "$REC/sm"
    if [ "\${FAKE_HANG:-}" = 1 ]; then : > "$REC/hang"; exec /bin/sleep 30; fi
    exit "\${FAKE_RC:-0}" ;;
  *" versions access "*) if [ -f "$REC/sm" ]; then cat "$REC/sm"; else echo "NOT_FOUND" >&2; exit 1; fi ;;
  *" versions list "*) echo "projects/p/secrets/vapid-private-key/versions/7 ENABLED 2026-11-17" ;;
esac
`,
    );
    sh(
      "gh",
      `for a in "$@"; do printf '%s\\n' "$a"; done >> "$REC/gh.argv"
case "$2" in
  set) cat > "$REC/gh.part"; if [ "\${FAKE_GH_SET_RC:-0}" != 0 ]; then rm -f "$REC/gh.part"; exit "$FAKE_GH_SET_RC"; fi; mv "$REC/gh.part" "$REC/ghvar" ;;
  get)
    if [ "\${FAKE_GH_GET_RC:-0}" != 0 ]; then exit "$FAKE_GH_GET_RC"; fi
    if [ -s "$REC/gh.seq" ]; then head -n 1 "$REC/gh.seq"; tail -n +2 "$REC/gh.seq" > "$REC/gh.seq2"; mv "$REC/gh.seq2" "$REC/gh.seq"
    elif [ -f "$REC/ghvar" ]; then cat "$REC/ghvar"; else exit 1; fi ;;
esac
`,
    );
    sh("sleep", `echo x >> "$REC/sleeps"\n`);
    // #202: mktemp bez szablonu na macOS ignoruje TMPDIR (plik ląduje w systemowym katalogu
    // tymczasowym, poza leftovers()). Fałszywy mktemp tworzy plik albo katalog (-d) zawsze w $TMPDIR świata.
    sh("mktemp", `if [ "\${1:-}" = -d ]; then exec /usr/bin/mktemp -d "$TMPDIR/tmp.XXXXXXXXXX"; fi\nexec /usr/bin/mktemp "$TMPDIR/tmp.XXXXXXXXXX"\n`);
    const env = (extra: Record<string, string> = {}) => ({
      NODE_ENV: "test" as const, PATH: `${bin}:${process.env.PATH}`, REC: rec, TMPDIR: tmp, HOME: home, ...extra,
    });
    const read = (f: string) => (existsSync(join(rec, f)) ? readFileSync(join(rec, f), "utf8") : "");
    const run = (shell: string, script: string, extra: Record<string, string> = {}, input?: string) =>
      spawnSync(shell, ["-c", script], { encoding: "utf8", cwd: ROOT, input, env: env(extra) });
    const leftovers = () => [tmp, home].flatMap((d) => readdirSync(d).map((f) => join(d, f)));
    return { bin, rec, sh, env, read, run, leftovers, write: (f: string, s: string) => writeFileSync(join(rec, f), s) };
  };
  const keypair = () => {
    const e = createECDH("prime256v1");
    e.generateKeys();
    return { priv: e.getPrivateKey().toString("base64url"), pub: e.getPublicKey().toString("base64url") };
  };
  const PEM = "-----BEGIN PRIVATE KEY-----\r\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n";

  describe.each(SHELLS)("powłoka %s", (shell) => {
    it.each([
      ["add", ""],
      ["add", "\r\n"],
      ["add_multiline", ""],
    ])("%s z pustą wartością (%j) → kod 1, komunikat z nazwą, gcloud niewywołany (K-1d B1)", (fn, input) => {
      const w = world();
      const r = w.run(shell, `${PRELUDE}\n${fn} nazwa-sekretu`, {}, input);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("error: empty value for nazwa-sekretu — gcloud not called");
      expect(w.read("gcloud.argv")).toBe("");
    });

    it("add: wartość bez końców wierszy na stdin gcloud, z wyłączonym logiem plikowym", () => {
      const w = world();
      const r = w.run(shell, `${PRELUDE}\nadd nazwa`, {}, "abc-123\r\n");
      expect(r.status, r.stderr).toBe(0);
      expect(w.read("sm")).toBe("abc-123");
      expect(w.read("gcloud.env").trim()).toBe("1");
      expect(w.read("gcloud.argv").split("\n")).toEqual(expect.arrayContaining(["versions", "add", "nazwa", "--data-file=-"]));
    });

    // N1 (Ethan): xtrace włączony przed wklejeniem — `set +x` w pierwszej linii bloku wyłącza go,
    // zanim wartość trafi do zmiennej lokalnej (przypisanie i printf byłyby inaczej śledzone na stderr).
    it.each(["add", "add_multiline"])("%s pod `set -x` włączonym przed blokiem: wartość nie trafia na stderr (Ethan N1)", (fn) => {
      const w = world();
      const value = "WARTOSC-TESTOWA-123";
      const r = w.run(shell, `set -x\n${PRELUDE}\n${fn} nazwa`, {}, `${value}\n`);
      expect(r.status, r.stderr).toBe(0);
      expect(w.read("sm")).toContain(value);
      expect(r.stderr, "xtrace był włączony").toContain("set +x");
      expect(r.stdout + r.stderr).not.toContain(value);
    });

    it("VAPID cały blok pod `set -x` włączonym przed blokiem: prywatny nie trafia na stderr (Ethan N1)", () => {
      const w = world();
      const r = w.run(shell, `set -x\n${PRELUDE}\n${VAPID}`);
      expect(r.status, r.stderr).toBe(0);
      const priv = w.read("sm");
      expect(priv).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(r.stderr, "xtrace był włączony").toContain("set +x");
      expect(r.stdout + r.stderr).not.toContain(priv);
    });

    it.each(["0", "1"])("add_multiline (gcloud rc=%s): treść wielowierszowa bajt w bajt, kod gcloud zachowany, nic na dysku", (rc) => {
      const w = world();
      const r = w.run(shell, `${PRELUDE}\nadd_multiline nazwa`, { FAKE_RC: rc }, PEM);
      expect(r.status).toBe(Number(rc));
      expect(w.read("sm")).toBe(PEM);
      expect(w.read("gcloud.env").trim()).toBe("1");
      expect(w.leftovers()).toEqual([]);
    });

    it("VAPID cały blok: para pasuje, „VAPID: para OK”, prywatny tylko na stdin gcloud; nic na dysku ani na ekranie", () => {
      const w = world();
      const r = w.run(shell, `${PRELUDE}\n${VAPID}`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("VAPID: para OK");
      const priv = w.read("sm");
      const pub = w.read("ghvar");
      expect(priv).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(pub).toMatch(/^[A-Za-z0-9_-]{87}$/);
      const e = createECDH("prime256v1");
      e.setPrivateKey(Buffer.from(priv, "base64url"));
      expect(e.getPublicKey().toString("base64url"), "para kluczy").toBe(pub);
      expect(new Set(w.read("gcloud.env").trim().split("\n"))).toEqual(new Set(["1"]));
      for (const f of ["gcloud.argv", "gh.argv", "ghvar"]) expect(w.read(f), f).not.toContain(priv);
      expect(r.stdout + r.stderr).not.toContain(priv);
      expect(w.leftovers()).toEqual([]);
    });

    it("VAPID: node bez wyjścia (np. poza katalogiem repo) → kod ≠ 0, gcloud niewywołany (K-1d B1)", () => {
      const w = world();
      w.sh("node", "exit 1\n");
      const r = w.run(shell, `${PRELUDE}\n${VAPID.split("\nvapid_check")[0]}`);
      expect(r.status).not.toBe(0);
      expect(w.read("gcloud.argv")).toBe("");
    });

    it("VAPID: node z uciętym wyjściem i kodem 1 → kod potoku ≠ 0 dzięki pipefail (K-1d B1)", () => {
      const w = world();
      w.sh("node", "printf 'uciete'\nexit 1\n");
      const r = w.run(shell, `${PRELUDE}\n${VAPID.split("\nvapid_check")[0]}`);
      expect(r.status).not.toBe(0);
    });

    it("vapid_check: stara wartość w gh przy pierwszej próbie, potem zgodna → „para OK” po jednym odczekaniu", () => {
      const w = world();
      const k = keypair();
      w.write("sm", k.priv);
      w.write("ghvar", k.pub);
      w.write("gh.seq", `${keypair().pub}\n`);
      const r = w.run(shell, `${PRELUDE}\nvapid_check`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("VAPID: para OK");
      expect(w.read("sleeps")).toBe("x\n");
      expect(r.stdout + r.stderr).not.toContain(k.priv);
    });

    it.each([
      ["inny klucz publiczny w gh", (w: ReturnType<typeof world>, k: { priv: string; pub: string }) => { w.write("sm", k.priv); w.write("ghvar", keypair().pub); }, {}],
      ["brak wersji prywatnej", (w: ReturnType<typeof world>, k: { priv: string; pub: string }) => { w.write("ghvar", k.pub); }, {}],
      ["gh variable get z błędem", (w: ReturnType<typeof world>, k: { priv: string; pub: string }) => { w.write("sm", k.priv); w.write("ghvar", k.pub); }, { FAKE_GH_GET_RC: "1" }],
      ["brak obu stron (puste = puste to nie para)", () => {}, {}],
    ])("vapid_check: %s → „VAPID: ROZJAZD”, kod 1 po 10 próbach", (_n, setup, extra) => {
      const w = world();
      const k = keypair();
      setup(w, k);
      const r = w.run(shell, `${PRELUDE}\nvapid_check`, extra as Record<string, string>);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("VAPID: ROZJAZD — powtórz CAŁY blok VAPID");
      expect(r.stdout).not.toContain("para OK");
      expect(w.read("sleeps")).toBe("x\n".repeat(10));
      expect(r.stdout + r.stderr).not.toContain(k.priv);
    });

    it.each([
      ["gcloud odrzuca nową wersję, gh ustawia nowy publiczny (stara para w SM)", { FAKE_ADD_RC: "1" }],
      ["gh odrzuca nowy publiczny, gcloud zapisuje nowy prywatny (stary publiczny w gh)", { FAKE_GH_SET_RC: "1" }],
    ])("VAPID cały blok, rozjazd: %s → „VAPID: ROZJAZD”, kod ≠ 0", (_n, extra) => {
      const w = world();
      const old = keypair();
      w.write("sm", old.priv);
      w.write("ghvar", old.pub);
      const r = w.run(shell, `${PRELUDE}\n${VAPID}`, extra);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("VAPID: ROZJAZD");
      expect(r.stdout).not.toContain("para OK");
    });
  });

  it("add_multiline przerwane Ctrl-C (SIGINT do grupy) w trakcie gcloud → nic nie zostaje na dysku", async () => {
    const w = world();
    const child = spawn("bash", ["-c", `${PRELUDE}\nadd_multiline nazwa`], {
      cwd: ROOT, detached: true, env: w.env({ FAKE_HANG: "1" }), stdio: ["pipe", "ignore", "ignore"],
    });
    const exited = new Promise<string>((res) => child.on("exit", (code, sig) => res(`exit ${code} ${sig}`)));
    child.stdin.end(PEM);
    // #202: czekamy na znacznik `hang`, nie na `sm`. `sm` pojawia się w chwili rename, gdy `mv` jeszcze
    // nie wyszedł; SIGINT w tym oknie trafia do powłoki gcloud czekającej na `mv`, `mv` kończy się
    // normalnie, powłoka idzie dalej i śpi 30 s (pod obciążeniem przekroczony limit 15 s).
    const hang = join(w.rec, "hang");
    for (let i = 0; i < 100 && !existsSync(hang); i++) await new Promise((res) => setTimeout(res, 50));
    expect(existsSync(hang), "etap 1: fałszywy gcloud nie doszedł do zawieszenia po odczycie wartości").toBe(true);
    process.kill(-child.pid!, "SIGINT");
    let timer: NodeJS.Timeout | undefined;
    const end = await Promise.race([exited, new Promise<string>((res) => { timer = setTimeout(() => res("timeout"), 8_000); })]);
    clearTimeout(timer);
    if (end === "timeout") process.kill(-child.pid!, "SIGKILL");
    expect(end, "etap 2: grupa procesów nie zakończyła się w 8 s po SIGINT").not.toBe("timeout");
    expect(w.read("sm")).toBe(PEM);
    expect(w.leftovers()).toEqual([]);
  }, 15_000);

  // Z1 (Ethan): interaktywny zsh Darka ma `interactivecomments` wyłączone — `#` nie zaczyna komentarza
  // nawet na początku linii. Cały blok przez stdin do `zsh -f -i` (czyta linia po linii jak przy wpisywaniu).
  it.skipIf(!existsSync("/bin/zsh"))(
    "cały blok D-5 w interaktywnym `zsh -f -i` (interactivecomments wyłączone): bez błędów i obcych poleceń, „VAPID: para OK” (Ethan Z1)",
    () => {
      const w = world();
      const secure = join(w.env().HOME, "secure");
      mkdirSync(secure);
      writeFileSync(join(secure, "stripe-secret-key"), "wartosc-stripe-1\n");
      writeFileSync(join(secure, "stripe-webhook-secret"), "wartosc-stripe-2\n");
      const r = spawnSync("/bin/zsh", ["-f", "-i"], {
        encoding: "utf8", cwd: ROOT, env: w.env({ PS1: "", PROMPT: "" }),
        input: `[[ -o interactivecomments ]] || echo INTERACTIVECOMMENTS-OFF\n${BODY}`,
      });
      const out = r.stdout + r.stderr;
      expect(r.stdout, "warunek testu: opcja wyłączona").toContain("INTERACTIVECOMMENTS-OFF");
      // Ethan Z1: cztery wzorce z recenzji; plus „no such file” (komentarz z `<` wykonany jako przekierowanie, :388 @483cff3).
      for (const bad of ["command not found", "parse error", "no matches found", "unknown", "no such file"]) expect(out, out).not.toContain(bad);
      expect(r.stdout, out).toContain("VAPID: para OK");
      expect(readdirSync(secure), "oryginały usunięte po udanym add").toEqual([]);
      const argv = w.read("gcloud.argv").split("\n");
      for (const name of ["better-auth-secret", "cron-secret", "vapid-private-key", "stripe-secret-key", "stripe-webhook-secret"]) {
        expect(argv, name).toContain(name);
      }
      expect(w.read("sm")).toBe("wartosc-stripe-2");
      expect(out).not.toContain("wartosc-stripe");
    },
    30_000,
  );

  it("D-5: rm -P nie jest przedstawiany jako wymazanie; oryginał od dostawcy usuwa człowiek", () => {
    expect(block).not.toMatch(/\brm -P\b/);
    expect(d5).toContain("`rm -P` na APFS");
    expect(d5).toMatch(/nie gwarantuje nadpisania danych/);
    expect(d5).toMatch(/Plik od dostawcy \(oryginał[^)]*\) usuwa człowiek/);
  });

  it("każdy sekret dodawany przez add — ze strumienia albo z pliku na stdin", () => {
    const uses = lines.filter((l) => /(^|\| *)add [a-z]/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const l of uses) expect(l).toMatch(/\| add [a-z-]+\s*$|^add [a-z-]+ < ("[^"]+") && rm \1$/);
    expect(uses.map((l) => l.match(/add ([a-z-]+)/)![1])).toEqual(
      expect.arrayContaining(["better-auth-secret", "cron-secret", "vapid-private-key", "stripe-secret-key", "stripe-webhook-secret"]),
    );
  });
});

// Z1/N1 (Ethan, K-1d) + zakres Olivera, rozszerzone w K-1e: KAŻDY płot kodu runbooka kroku D
// (```bash, ```sh, ```zsh, płot bez języka i każdy inny) jest blokiem do wklejenia w interaktywnym zsh
// bez `interactivecomments` — chyba że stoi na jawnej liście wyjątków niżej (nie-powłoka).
// Zero komentarzy (objaśnienia w prozie); bloki dotykające sekretów zaczynają się od `set +x`.
describe("G-D2: płoty kodu runbooka kroku D — bez komentarzy, `set +x` przy sekretach (Z1, N1, K-1e)", () => {
  const RUNBOOK = readFileSync(join(ROOT, "docs/runbook-krok-d.md"), "utf8");
  const FENCES = [...RUNBOOK.matchAll(/^```([^\n`]*)\n([\s\S]*?)^```$/gm)].map((m) => ({
    lang: (m[1] ?? "").trim(),
    body: m[2] ?? "",
    first: (m[2] ?? "").split("\n")[0] ?? "",
  }));
  // Jawna lista wyjątków: płoty, które NIE są poleceniami powłoki (język + dokładna pierwsza linia).
  const NOT_SHELL = [
    { lang: "", first: "assertion.repository_id == '1152153440' &&", why: "warunek atrybutów WIF (CEL) dla --wif-condition-file, sekcja 3.8" },
    { lang: "sql", first: "SELECT rolname, rolcanlogin, rolbypassrls, rolsuper,", why: "zapytanie wpisywane w psql, D-7" },
  ];
  const isException = (f: { lang: string; first: string }) => NOT_SHELL.some((e) => e.lang === f.lang && e.first === f.first);
  const SHELL = FENCES.filter((f) => !isException(f));
  const SECRET_TRIGGER = /secrets versions|PGPASSWORD|Authorization:|gh secret set|--flags-file|--data-file|password|access-token/i;

  it.each(NOT_SHELL.map((e) => [e.why, e]))("wyjątek (%s) występuje dokładnie raz, z tym językiem i tą pierwszą linią", (_why, e) => {
    expect(FENCES.filter((f) => f.lang === e.lang && f.first === e.first)).toHaveLength(1);
  });

  it("płotów do wklejenia (wszystkie poza wyjątkami) jest co najmniej 12; płoty liczone bez względu na język", () => {
    expect(FENCES.length).toBe(SHELL.length + NOT_SHELL.length);
    expect(SHELL.length).toBeGreaterThanOrEqual(12);
  });

  it.each(SHELL.map((f, i) => [i, f.lang || "bez języka", f.first.slice(0, 50), f.body]))(
    "płot %i (%s, %s): żadna linia nie zaczyna się od `#` ani nie ma ` #` w środku",
    (_i, _lang, _first, body) => {
      for (const l of String(body).split("\n")) {
        expect(l, l).not.toMatch(/^\s*#/);
        expect(l, l).not.toMatch(/\s#/);
      }
    },
  );

  it("płoty dotykające sekretów zaczynają się od `set +x` (Secret Manager, hasło, Authorization, gh secret set, --flags-file, --data-file, access-token)", () => {
    const touching = SHELL.filter((f) => SECRET_TRIGGER.test(f.body));
    expect(touching.length).toBeGreaterThanOrEqual(4);
    for (const f of touching) expect(f.first, f.body).toMatch(/^set \+x(;|$)/);
  });

  it.each([
    "gh secret set X --env production-gcp < plik",
    "gcloud scheduler jobs update http j --flags-file=<(printf x)",
    "gcloud secrets versions add s --data-file=-",
    "PGPASSWORD=x psql",
    "postgres-admin-password",
    "gcloud auth print-access-token",
    "Authorization: Bearer x",
  ])("wyzwalacz sekretu obejmuje: %s", (l) => {
    expect(l).toMatch(SECRET_TRIGGER);
  });

  // K-1e pkt 3: zasady ogólne zgodne z D-5 — żadnego dopuszczenia ścieżki pliku w --data-file.
  it("`--data-file=ŚCIEŻKA` występuje wyłącznie jako zakaz („nigdy”); zasady ogólne bez „pliku spoza repo”", () => {
    const at = [...RUNBOOK.matchAll(/--data-file=ŚCIEŻKA/g)].map((m) => m.index ?? 0);
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (const i of at) expect(RUNBOOK.slice(Math.max(0, i - 7), i)).toBe("nigdy `");
    const s0 = RUNBOOK.slice(RUNBOOK.indexOf("## 0. Zasady"), RUNBOOK.indexOf("## 1. Przed startem"));
    expect(s0).not.toMatch(/plik\s+spoza\s+repo/);
    expect(s0).toMatch(/Wyłącznie strumień do `--data-file=-`/);
  });

  // K-1e pkt 4: §9 — proxy do bazy nie zostaje w tle.
  const s9 = RUNBOOK.slice(RUNBOOK.indexOf("## 9. Dostęp administracyjny"), RUNBOOK.indexOf("## 10."));
  const B9 = s9.slice(s9.indexOf("```bash\n") + 8, s9.indexOf("\n```", s9.indexOf("```bash\n")));

  it("§9: ostatnia linia bloku to `kill %1`", () => {
    const ls = B9.split("\n");
    expect(ls[0]).toBe("set +x");
    expect(ls[ls.length - 1]).toBe("kill %1");
    expect(ls.filter((l) => l.endsWith(" &"))).toHaveLength(1);
  });

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  it.each(["bash", ...(existsSync("/bin/zsh") ? ["/bin/zsh"] : [])])(
    "§9 wykonany w %s z fałszywymi cloud-sql-proxy, gcloud i psql: po wyjściu z psql proxy nie żyje; hasło tylko w środowisku psql",
    async (shell) => {
      const root = join(DIR, `s9-${n++}`);
      const bin = join(root, "bin");
      const rec = join(root, "rec");
      for (const d of [bin, rec]) mkdirSync(d, { recursive: true });
      const sh = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}`);
        chmodSync(join(bin, name), 0o755);
      };
      sh("cloud-sql-proxy", `echo $$ > "$REC/proxy.pid"\nexec /bin/sleep 30\n`);
      sh("gcloud", `printf '%s' haslo-testowe-9\n`);
      sh(
        "psql",
        `i=0; while [ ! -s "$REC/proxy.pid" ] && [ $i -lt 50 ]; do /bin/sleep 0.1; i=$((i+1)); done
printf '%s' "$PGPASSWORD" > "$REC/psql.env"
for a in "$@"; do printf '%s\\n' "$a"; done > "$REC/psql.argv"
`,
      );
      const r = spawnSync(shell, ["-c", B9], {
        encoding: "utf8", cwd: ROOT, env: { NODE_ENV: "test" as const, PATH: `${bin}:${process.env.PATH}`, REC: rec, HOME: root },
      });
      const pid = Number(readFileSync(join(rec, "proxy.pid"), "utf8").trim());
      try {
        expect(r.status, r.stderr).toBe(0);
        expect(readFileSync(join(rec, "psql.env"), "utf8")).toBe("haslo-testowe-9");
        expect(readFileSync(join(rec, "psql.argv"), "utf8")).not.toContain("haslo-testowe-9");
        expect(r.stdout + r.stderr).not.toContain("haslo-testowe-9");
        for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
        expect(alive(pid), "proxy żyje po bloku").toBe(false);
      } finally {
        if (alive(pid)) process.kill(pid, "SIGKILL");
      }
    },
    15_000,
  );
});

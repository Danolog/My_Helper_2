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
 *  - rola kopii: dokładnie trzy uprawnienia, warunek Instance + BackupRun (W-1);
 *  - idempotencja: istniejące zasoby nie są tworzone ponownie.
 * Mutacje (scratchpad, wynik w PR): usunąć --edition; edycja enterprise-plus;
 * objectViewer zamiast legacyObjectReader; usunąć --deletion-protection;
 * wykonywać w dry-run; przyjąć pusty warunek WIF; dopuścić `||`; hasło jako
 * --password=; wypisać hasło; secretAccessor na projekcie; --data-file w
 * etapie secrets; describe bez sprawdzania (brak idempotencji).
 */
import { spawn, spawnSync } from "node:child_process";
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
    [ -n "$FAKE_EXISTS$FAKE_USERS_EXIST" ] && exit 0; exit 1 ;;
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
  usersExist?: boolean;
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
      ...(opts.usersExist ? { FAKE_USERS_EXIST: "1" } : {}),
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
  it.each(STAGES)("etap %s: domyślnie dry-run — zero wywołań gcloud, także odczytów", (stage) => {
    const r = bootstrap(base(stage));
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stdout).toContain(`stage ${stage}: done`);
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
      expect.stringMatching(/sql users create myhelper_owner --instance=myhelper-pg --flags-file=\S+$/),
      expect.stringMatching(/sql users set-password postgres --instance=myhelper-pg --flags-file=\S+$/),
    ]);
    // stdin: najpierw postgres-url, potem samo hasło postgres — oba z wygenerowanych haseł.
    const [url, admin] = r.stdin.split("\n");
    expect(url).toBe(
      `postgresql://myhelper_owner:${pw[0]}@localhost/myhelper?host=/cloudsql/${PROJECT}:europe-central2:myhelper-pg`,
    );
    expect(url).not.toMatch(/sslmode/);
    expect(admin).toBe(pw[1]);
    const adds = r.calls.filter((c) => c.includes("versions add"));
    expect(adds.map((c) => c.split(" ")[5])).toEqual(["postgres-url", "postgres-admin-password"]);
    for (const c of adds) expect(c).toMatch(/ --data-file=-$/);
  });

  it("bootstrap tworzy jeden login myhelper_owner — nigdy ról NOLOGIN ani SQL (to robią migracje)", () => {
    expect(SOURCE).toMatch(/^DB_USER="myhelper_owner"$/m);
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
    expect(e.stderr).toMatch(/cannot read versions of secret postgres-url/);
    expect(e.calls.filter((c) => /sql users (create|set-password)|versions add/.test(c))).toEqual([]);
    expect(e.flags + e.stdin).toBe("");
  });

  it("samonaprawa: login istnieje, sekret bez wersji → set-password (nie create) i nowa wersja", () => {
    const h = bootstrap([...base("sql"), "--apply"], { usersExist: true });
    expect(h.status, h.stderr).toBe(0);
    const users = h.calls.filter((c) => /sql users (create|set-password)/.test(c));
    expect(users).toEqual([
      expect.stringMatching(/sql users set-password myhelper_owner --instance=myhelper-pg --flags-file=\S+$/),
      expect.stringMatching(/sql users set-password postgres --instance=myhelper-pg --flags-file=\S+$/),
    ]);
    expect(h.calls.filter((c) => c.includes("versions add")).map((c) => c.split(" ")[5])).toEqual([
      "postgres-url",
      "postgres-admin-password",
    ]);
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

  it("dry-run sql nie generuje hasła (same placeholdery)", () => {
    const d = bootstrap(base("sql"));
    expect(d.stdout).toContain("--flags-file=<(--password: <generated>)");
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

  it("W-1: wiązanie roli kopii dla deploy z warunkiem Instance + BackupRun tej instancji", () => {
    const b = r.calls.filter((c) => c.includes("roles/myhelperSqlBackup"));
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("--member=serviceAccount:myhelper-deploy@");
    const condition = b[0]!.split(" --condition=")[1];
    expect(condition).toBe(
      'expression=(resource.type == "sqladmin.googleapis.com/Instance" && resource.name == "projects/my-helper-2-488419/instances/myhelper-pg") || ' +
        '(resource.type == "sqladmin.googleapis.com/BackupRun" && resource.name.startsWith("projects/my-helper-2-488419/instances/myhelper-pg/")),' +
        "title=only-myhelper-pg-backups",
    );
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
  const lines = block.split("\n").filter((l) => !l.trim().startsWith("#"));

  it("funkcja add: tr -d '\\r\\n' → gcloud z CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 i --data-file=-", () => {
    expect(block).toContain(
      `add() { tr -d '\\r\\n' | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }`,
    );
  });

  it("jedyne `secrets versions add` to funkcje add i add_multiline; żadnego --data-file=ŚCIEŻKA ani starego tr -d '\\n'", () => {
    const adds = lines.filter((l) => l.includes("secrets versions add"));
    expect(adds).toHaveLength(2);
    expect(adds[0]).toMatch(/^add\(\) \{/);
    expect(adds[1]).toMatch(/^add_multiline\(\) \{/);
    expect(block).not.toMatch(/--data-file=(?!-)/);
    expect(block).not.toContain("tr -d '\\n'");
  });

  // K-1d (Ryan, Ethan do #177): wielowierszowe (PEM, JSON) bez tr, ze stdin, bez własnej kopii na dysku.
  it("funkcja add_multiline: --data-file=- ze stdin, bez tr, bez logu plikowego, bez pliku tymczasowego", () => {
    expect(block).toContain(
      `add_multiline() { CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }`,
    );
    const fn = lines.find((l) => l.startsWith("add_multiline() {"))!;
    expect(fn).not.toMatch(/\btr\b/);
    expect(d5).not.toMatch(/mktemp/);
  });

  it("D-5: rm -P nie jest przedstawiany jako wymazanie; oryginał od dostawcy usuwa człowiek", () => {
    expect(block).not.toMatch(/\brm -P\b/);
    expect(d5).toContain("`rm -P` na APFS");
    expect(d5).toMatch(/nie gwarantuje nadpisania danych/);
    expect(d5).toMatch(/Plik od dostawcy \(oryginał[^)]*\) usuwa człowiek/);
  });

  // Fałszywy gcloud: zapisuje stdin (gdy --data-file=-) albo plik z --data-file do $SEEN, potem kod FAKE_RC;
  // FAKE_HANG=1 → po odczycie wisi (przerwanie w trakcie gcloud).
  const multilineWorld = () => {
    const root = join(DIR, `rb-${n++}`);
    const bin = join(root, "bin");
    const tmp = join(root, "tmp");
    const home = join(root, "home");
    const cwd = join(root, "cwd");
    for (const d of [bin, tmp, home, cwd]) mkdirSync(d, { recursive: true });
    const seen = join(root, "seen");
    writeFileSync(
      join(bin, "gcloud"),
      `#!/bin/sh\nprintf '%s\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING-unset}" > "$SEEN.env"\nfor a in "$@"; do case "$a" in --data-file=-) cat > "$SEEN.part";; --data-file=*) cat "\${a#--data-file=}" > "$SEEN.part";; esac; done\nmv "$SEEN.part" "$SEEN"\n[ "\${FAKE_HANG:-}" = 1 ] && sleep 30\nexit "\${FAKE_RC:-0}"\n`,
    );
    chmodSync(join(bin, "gcloud"), 0o755);
    const fn = lines.find((l) => l.startsWith("add_multiline() {"))!;
    const args = ["-c", `P=p-123; ${fn}\nadd_multiline nazwa`];
    const env = (extra: Record<string, string>) => ({
      NODE_ENV: "test" as const, PATH: `${bin}:${process.env.PATH}`, SEEN: seen, TMPDIR: tmp, HOME: home, ...extra,
    });
    const leftovers = () => [tmp, home, cwd].flatMap((d) => readdirSync(d).map((f) => join(d, f)));
    return { seen, cwd, args, env, leftovers };
  };
  const PEM = "-----BEGIN PRIVATE KEY-----\r\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n";

  it.each(["0", "1"])("add_multiline wykonane (gcloud rc=%s): treść wielowierszowa bajt w bajt, kod gcloud zachowany, nic na dysku", (rc) => {
    const w = multilineWorld();
    const r = spawnSync("bash", w.args, { encoding: "utf8", cwd: w.cwd, input: PEM, env: w.env({ FAKE_RC: rc }) });
    expect(r.status).toBe(Number(rc));
    expect(readFileSync(w.seen, "utf8")).toBe(PEM);
    expect(readFileSync(`${w.seen}.env`, "utf8").trim()).toBe("1");
    expect(w.leftovers()).toEqual([]);
  });

  it("add_multiline przerwane Ctrl-C (SIGINT do grupy) w trakcie gcloud → nic nie zostaje na dysku", async () => {
    const w = multilineWorld();
    const child = spawn("bash", w.args, { cwd: w.cwd, detached: true, env: w.env({ FAKE_HANG: "1" }), stdio: ["pipe", "ignore", "ignore"] });
    const exited = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
    child.stdin.end(PEM);
    for (let i = 0; i < 100 && !existsSync(w.seen); i++) await new Promise((res) => setTimeout(res, 50));
    expect(existsSync(w.seen), "gcloud odczytał wartość").toBe(true);
    process.kill(-child.pid!, "SIGINT");
    await exited;
    expect(readFileSync(w.seen, "utf8")).toBe(PEM);
    expect(w.leftovers()).toEqual([]);
  }, 15_000);

  it("każdy sekret dodawany przez add — ze strumienia albo z pliku na stdin", () => {
    const uses = lines.filter((l) => /(^|\| *)add [a-z]/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const l of uses) expect(l).toMatch(/\| add [a-z-]+\s*$|^add [a-z-]+ < "[^"]+"(\s+#.*)?$/);
    expect(uses.map((l) => l.match(/add ([a-z-]+)/)![1])).toEqual(
      expect.arrayContaining(["better-auth-secret", "cron-secret", "vapid-private-key", "stripe-secret-key", "stripe-webhook-secret"]),
    );
  });
});

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
 *  - WIF: warunek z pliku, niepusty, z czterema zawężeniami, bez `||`;
 *  - idempotencja: istniejące zasoby nie są tworzone ponownie.
 * Mutacje (scratchpad, wynik w PR): usunąć --edition; edycja enterprise-plus;
 * objectViewer zamiast legacyObjectReader; usunąć --deletion-protection;
 * wykonywać w dry-run; przyjąć pusty warunek WIF; dopuścić `||`; hasło jako
 * --password=; wypisać hasło; secretAccessor na projekcie; --data-file w
 * etapie secrets; describe bez sprawdzania (brak idempotencji).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  "assertion.event_name == 'workflow_dispatch' &&",
  "assertion.run_attempt == '1'",
].join("\n");

const DIR = mkdtempSync(join(tmpdir(), "g-d1-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const FAKE = join(DIR, "bin");
spawnSync("mkdir", ["-p", FAKE]);
writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
for a in "$@"; do
  case "$a" in
    --flags-file=*) cat "\${a#--flags-file=}" >> "$FAKE_FLAGS" ;;
    --data-file=-) cat >> "$FAKE_STDIN"; printf '\\n' >> "$FAKE_STDIN" ;;
  esac
done
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
}

function bootstrap(args: string[], opts: { exists?: boolean } = {}): Run {
  const id = n++;
  const log = join(DIR, `log-${id}`);
  const flags = join(DIR, `flags-${id}`);
  const stdin = join(DIR, `stdin-${id}`);
  for (const f of [log, flags, stdin]) writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${FAKE}:${process.env.PATH}`,
      FAKE_LOG: log,
      FAKE_FLAGS: flags,
      FAKE_STDIN: stdin,
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
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
        expect(line).toMatch(/^(mode: |\? gcloud |\+ gcloud |  state: |  policy: |  condition: |  skip: |  GCP_[A-Z_]+=|stage [a-z]+: done$)/);
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
  ])("%s → błąd przed pierwszym gcloud, także z --apply", (_label, args) => {
    const r = bootstrap([...args, "--apply"]);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
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
    for (const l of lines) expect(l).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$|^\s*echo "[+?] gcloud /);
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
    expect(r.stdout).toContain('"keepCount": 5');
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
    expect(SECRET_NAMES.length).toBe(11);
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

  it("hasło postgres trafia do osobnego sekretu spoza manifestu (bez dostępu runtime)", () => {
    expect(SECRET_NAMES).not.toContain("postgres-admin-password");
    const sa = bootstrap([...base("sa"), "--apply"]);
    expect(sa.calls.join("\n")).not.toContain("postgres-admin-password");
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
    ["bez run_attempt", VALID_CONDITION.replace(" &&\nassertion.run_attempt == '1'", "")],
    ["alternatywa ||", `${VALID_CONDITION} || true`],
  ];
  it.each(broken)("%s → odrzucony przed jakimkolwiek wywołaniem, także w dry-run", (_label, text) => {
    for (const mode of [[], ["--apply"]]) {
      const r = bootstrap([...base("wif", cond(text)), ...mode]);
      expect(r.status).toBe(2);
      expect(r.calls).toEqual([]);
    }
  });
});

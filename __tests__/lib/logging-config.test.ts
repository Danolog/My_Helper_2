// @vitest-environment node
/**
 * Strażnik konfiguracji logów: infra/gcp/logging.sh.
 * Skrypt jest uruchamiany z podstawionym `gcloud` (zapisuje argumenty i treść
 * pliku polityki IAM), więc testy sprawdzają ZACHOWANIE:
 *  - domyślnie dry-run: zero wywołań gcloud, także odczytów;
 *  - każde wywołanie idzie z --project i --quiet; jedyne wywołanie w kodzie to tablica GC;
 *  - (1) filtr wykluczający w ujściu _Default: DOKŁADNE wyrażenie (adres żądania
 *    i Referer), zgodne ze ścieżkami tokenów w zainstalowanym Better Auth;
 *  - (2) retencja _Default = 30 dni jawnie;
 *  - (3) Data Access DATA_READ dla secretmanager.googleapis.com: zmienia się
 *    wyłącznie auditConfigs, wiązania i etag bez zmian, polityka (z adresami
 *    kont) nie trafia do wyjścia ani do lokalnego logu gcloud;
 *  - (4) zasobnik audytu w europe-central2 z retencją 365 dni + ujście
 *    audytu Secret Manager i Admin Activity;
 *  - brak add-iam-policy-binding, brak usuwania, brak blokady retencji.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/logging.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
const CODE = SOURCE.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const PROJECT = "my-helper-2-488419";
const REGION = "europe-central2";
const EMAIL = "wlasciciel-testowy@example.invalid";

/** Wyrażenie RE2 ścieżek z tokenem w adresie (dosłownie jak w skrypcie). */
const TOKEN_RE = "/(api/auth/)?(verify-email|reset-password)";
const EXCLUSION_FILTER = `httpRequest.requestUrl=~"${TOKEN_RE}" OR httpRequest.referer=~"${TOKEN_RE}"`;
const AUDIT_DEST = `logging.googleapis.com/projects/${PROJECT}/locations/${REGION}/buckets/myhelper-audit`;
const AUDIT_FILTER =
  `logName="projects/${PROJECT}/logs/cloudaudit.googleapis.com%2Factivity" OR ` +
  `(logName="projects/${PROJECT}/logs/cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="secretmanager.googleapis.com")`;

const DIR = mkdtempSync(join(tmpdir(), "p8-logging-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const FAKE = join(DIR, "bin");
mkdirSync(FAKE, { recursive: true });

const POLICY = {
  version: 1,
  etag: "BwXtest123=",
  bindings: [
    { role: "roles/owner", members: [`user:${EMAIL}`] },
    { role: "roles/run.developer", members: ["serviceAccount:deploy@example.invalid"] },
  ],
  auditConfigs: [{ service: "storage.googleapis.com", auditLogConfigs: [{ logType: "ADMIN_READ" }] }],
};
const POLICY_PRESENT = {
  ...POLICY,
  auditConfigs: [
    ...POLICY.auditConfigs,
    { service: "secretmanager.googleapis.com", auditLogConfigs: [{ logType: "DATA_READ" }] },
  ],
};
writeFileSync(join(DIR, "policy.json"), JSON.stringify(POLICY));
writeFileSync(join(DIR, "policy-present.json"), JSON.stringify(POLICY_PRESENT));

writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case " $* " in
  *" get-iam-policy "*)
    printf 'nolog-get=%s\\n---\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING:-}" >> "$FAKE_FILES"
    [ -n "$FAKE_READ_ERROR" ] && { echo "ERROR: PERMISSION_DENIED $FAKE_EMAIL" >&2; exit 1; }
    cat "$FAKE_POLICY"; exit 0 ;;
  *" set-iam-policy "*)
    printf 'nolog-set=%s\\n---\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING:-}" >> "$FAKE_FILES"
    for a in "$@"; do last="$a"; done
    cat "$last" >> "$FAKE_FILES"; printf '\\n---\\n' >> "$FAKE_FILES"
    echo "bindings: - members: [user:$FAKE_EMAIL]"; echo "Updated IAM policy for $FAKE_EMAIL" >&2
    exit 0 ;;
  *" sinks describe _Default "*)
    [ -n "$FAKE_READ_ERROR" ] && { echo "ERROR: PERMISSION_DENIED" >&2; exit 1; }
    [ -n "$FAKE_EXISTS" ] && echo "other-exclusion;myhelper-auth-token-urls"
    exit 0 ;;
esac
[ -n "$FAKE_EXISTS" ] && exit 0
case " $* " in *" describe "*) exit 1 ;; esac
exit 0
`,
);
chmodSync(join(FAKE, "gcloud"), 0o755);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
  files: string;
}

let n = 0;
function lg(
  args: string[],
  opts: { exists?: boolean; auditPresent?: boolean; readError?: boolean } = {},
): Run {
  const id = n++;
  const log = join(DIR, `log-${id}`);
  const files = join(DIR, `files-${id}`);
  for (const f of [log, files]) writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${FAKE}:${process.env.PATH}`,
      FAKE_LOG: log,
      FAKE_FILES: files,
      FAKE_EMAIL: EMAIL,
      FAKE_POLICY: join(DIR, opts.auditPresent ? "policy-present.json" : "policy.json"),
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
      ...(opts.readError ? { FAKE_READ_ERROR: "1" } : {}),
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
    files: readFileSync(files, "utf8"),
  };
}

const P = [`--project=${PROJECT}`];
const APPLY = [...P, "--apply"];
const strip = (c: string) => c.replace(`--project=${PROJECT} --quiet `, "");
const MUTATING = / (create|update|set-iam-policy|delete|enable|add-iam-policy-binding) /;

/** Ostatni zapisany plik polityki z set-iam-policy (JSON między separatorami). */
function setPolicy(files: string): Record<string, unknown> {
  const blocks = files.split("\n---\n").filter((b) => b.trim().startsWith("{"));
  expect(blocks).toHaveLength(1);
  return JSON.parse(blocks[0]!) as Record<string, unknown>;
}

describe("P8: dry-run i parametry", () => {
  it.each([
    ["bez flag", P],
    ["--project ze spacją", ["--project", PROJECT]],
    ["jawny region", [...P, `--region=${REGION}`]],
  ])("%s: domyślnie dry-run — zero wywołań gcloud, także odczytów", (_l, args) => {
    const r = lg(args);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stdout).toMatch(/\nlogging: done\n$/);
  });

  it("jawne --dry-run po --apply wygrywa i nic nie wykonuje", () => {
    expect(lg([...APPLY, "--dry-run"]).calls).toEqual([]);
  });

  it("wyjście dry-run to wyłącznie polecenia, odczyty stanu i opis zmiany", () => {
    for (const line of lg(P).stdout.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^(mode: |\? gcloud |\+ gcloud |  state: |  audit: |  skip: |logging: done$)/);
    }
  });

  it("dry-run wypisuje kroki (1)–(4) w kolejności z §2 P8", () => {
    const plus = lg(P)
      .stdout.split("\n")
      .filter((l) => l.startsWith("+ gcloud "))
      .map((l) => l.replace(`+ gcloud --project=${PROJECT} --quiet `, ""));
    expect(plus.map((c) => c.split(" ").slice(0, 3).join(" "))).toEqual([
      "logging sinks update",
      "logging buckets update",
      `projects set-iam-policy ${PROJECT}`,
      "logging buckets create",
      "logging sinks create",
    ]);
  });

  it.each([
    ["bez --project", ["--apply"]],
    ["nieprawidłowy projekt", ["--project=Bad_Project", "--apply"]],
    ["region spoza allowlisty", [...APPLY, "--region=europe-west1"]],
    ["nieznany argument", [...APPLY, "--force"]],
    ["inna retencja z linii poleceń", [...APPLY, "--retention-days=7"]],
    ["inny zasobnik z linii poleceń", [...APPLY, "--bucket=inny"]],
  ])("%s → błąd przed pierwszym gcloud", (_l, args) => {
    const r = lg(args);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

describe("P8: każde wywołanie przez GC (--project, --quiet)", () => {
  it.each([
    ["stan pusty", false, false],
    ["zasoby istnieją", true, true],
  ])("%s z --apply", (_l, exists, auditPresent) => {
    const r = lg(APPLY, { exists, auditPresent });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) expect(c.startsWith(`--project=${PROJECT} --quiet `), c).toBe(true);
  });

  it("w kodzie jedyne wywołanie gcloud to tablica GC (reszta to echo)", () => {
    const lines = SOURCE.split("\n").filter((l) => /\bgcloud\b/.test(l) && !l.trim().startsWith("#"));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$|^\s*echo "[+?] gcloud /);
  });

  it("w kodzie brak gsutil, curl, wget, vercel, add-iam-policy-binding, --locked, delete", () => {
    expect(CODE).not.toMatch(/\b(gsutil|curl|wget|vercel)\b/);
    expect(CODE).not.toMatch(/add-iam-policy-binding|remove-iam-policy-binding|--locked|\bdelete\b|--remove-exclusions/);
  });

  it("region: lokalizacja wyłącznie europe-central2, poza zasobnikiem _Default (global z natury)", () => {
    expect(SOURCE.match(/\b(europe|us|asia|me|africa|northamerica|southamerica|australia)-[a-z]+\d\b/g)?.every((x) => x === REGION)).toBe(true);
    for (const c of lg(APPLY).calls.map(strip)) {
      if (/^logging buckets (update|describe) _Default /.test(c)) {
        expect(c).toContain("--location=global");
        continue;
      }
      expect(c, c).not.toMatch(/ --(region|location)=(?!europe-central2( |$))/);
    }
  });

  it("w kodzie brak adresów e-mail", () => {
    expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });
});

describe("P8 (1): filtr wykluczający tokeny w ujściu _Default", () => {
  it("dokładne wyrażenie filtru w kodzie", () => {
    expect(SOURCE).toContain(`TOKEN_RE='${TOKEN_RE}'`);
    expect(SOURCE).toContain('EXCLUSION_FILTER="httpRequest.requestUrl=~\\"${TOKEN_RE}\\" OR httpRequest.referer=~\\"${TOKEN_RE}\\""');
  });

  it("brak wykluczenia → --add-exclusion z dokładnym filtrem", () => {
    const c = lg(APPLY).calls.map(strip).filter((x) => /^logging sinks update _Default /.test(x));
    expect(c).toEqual([`logging sinks update _Default --add-exclusion=name=myhelper-auth-token-urls,filter=${EXCLUSION_FILTER}`]);
  });

  it("wykluczenie istnieje → --update-exclusion z tym samym filtrem (bez dryfu)", () => {
    const c = lg(APPLY, { exists: true, auditPresent: true }).calls.map(strip).filter((x) => /^logging sinks update _Default /.test(x));
    expect(c).toEqual([`logging sinks update _Default --update-exclusion=name=myhelper-auth-token-urls,filter=${EXCLUSION_FILTER}`]);
  });

  it("filtr nie ma przecinka (rozdziela pola --add-exclusion)", () => {
    expect(EXCLUSION_FILTER).not.toContain(",");
  });

  it("błąd odczytu ujścia _Default przerywa przebieg przed zmianą", () => {
    const r = lg(APPLY, { readError: true });
    expect(r.status).toBe(2);
    expect(r.calls.map(strip).filter((c) => MUTATING.test(` ${c} `))).toEqual([]);
  });

  const re = new RegExp(TOKEN_RE);
  it.each([
    "https://app.nordsignal.cc/api/auth/verify-email?token=eyJhbGciOi.x.y&callbackURL=%2F",
    "https://app.nordsignal.cc/api/auth/reset-password/AbCdEf123456?callbackURL=%2Freset-password",
    "https://app.nordsignal.cc/reset-password?token=AbCdEf123456",
    "https://myhelper-xyz-lm.a.run.app/api/auth/reset-password/AbCdEf123456?callbackURL=%2Freset-password",
  ])("obejmuje adres z tokenem: %s", (url) => {
    expect(re.test(url)).toBe(true);
  });

  it.each([
    "https://app.nordsignal.cc/api/auth/sign-in/email",
    "https://app.nordsignal.cc/api/auth/request-password-reset",
    "https://app.nordsignal.cc/api/auth/get-session",
    "https://app.nordsignal.cc/api/auth/callback/google?code=x&state=y",
    "https://app.nordsignal.cc/forgot-password",
    "https://app.nordsignal.cc/api/health",
    "https://app.nordsignal.cc/login?callbackURL=%2Freset-password",
  ])("nie obejmuje: %s", (url) => {
    expect(re.test(url)).toBe(false);
  });

  // Zmiana postaci linków w bibliotece (aktualizacja Better Auth) ma zatrzymać
  // ten test, zanim filtr przestanie obejmować nowy adres.
  it("ścieżki tokenów w zainstalowanym Better Auth i w kodzie aplikacji odpowiadają filtrowi", () => {
    const dist = join(ROOT, "node_modules/better-auth/dist/api/routes");
    const pw = readFileSync(join(dist, "password.mjs"), "utf8");
    const ev = readFileSync(join(dist, "email-verification.mjs"), "utf8");
    expect(pw).toContain("const url = `${ctx.context.baseURL}/reset-password/${verificationToken}?callbackURL=${callbackURL}`;");
    expect(pw).toContain("throw ctx.redirect(redirectCallback(ctx.context, callbackURL, { token }));");
    expect(ev).toContain("const url = `${ctx.context.baseURL}/verify-email?token=${token}&callbackURL=${callbackURL}`;");
    const form = readFileSync(join(ROOT, "src/components/auth/forgot-password-form.tsx"), "utf8");
    expect(form).toContain('redirectTo: "/reset-password"');
    for (const p of ["/api/auth/reset-password/T", "/api/auth/verify-email?token=T", "/reset-password?token=T"]) {
      expect(re.test(p), p).toBe(true);
    }
  });

  it("Referer niesie adres strony z tokenem (Referrer-Policy wysyła pełny adres w obrębie originu)", () => {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(cfg).toMatch(/key: "Referrer-Policy",\s*value: "strict-origin-when-cross-origin"/);
    expect(EXCLUSION_FILTER).toContain(`httpRequest.referer=~"${TOKEN_RE}"`);
  });
});

describe("P8 (2): retencja _Default = 30 dni jawnie", () => {
  it("buckets update _Default --location=global --retention-days=30 przy każdym --apply", () => {
    for (const o of [{}, { exists: true, auditPresent: true }]) {
      const c = lg(APPLY, o).calls.map(strip).filter((x) => /^logging buckets update _Default /.test(x));
      expect(c).toEqual(["logging buckets update _Default --location=global --retention-days=30"]);
    }
  });
});

describe("P8 (3): Data Access DATA_READ dla Secret Manager", () => {
  it("dopisuje wyłącznie auditConfigs; wiązania, etag i inne usługi bez zmian", () => {
    const r = lg(APPLY);
    expect(r.status, r.stderr).toBe(0);
    const calls = r.calls.map(strip);
    expect(calls.filter((c) => /^projects get-iam-policy /.test(c))).toEqual([`projects get-iam-policy ${PROJECT} --format=json`]);
    expect(calls.filter((c) => /^projects set-iam-policy /.test(c))).toHaveLength(1);
    const p = setPolicy(r.files);
    expect(p.bindings).toEqual(POLICY.bindings);
    expect(p.etag).toBe(POLICY.etag);
    expect(p.version).toBe(POLICY.version);
    expect(p.auditConfigs).toEqual([
      ...POLICY.auditConfigs,
      { service: "secretmanager.googleapis.com", auditLogConfigs: [{ logType: "DATA_READ" }] },
    ]);
  });

  it("polityka (adresy kont) nie trafia do wyjścia; bez lokalnego logu gcloud", () => {
    const r = lg(APPLY);
    expect(r.stdout + r.stderr).not.toContain(EMAIL);
    expect(r.files).toContain("nolog-get=1\n");
    expect(r.files).toContain("nolog-set=1\n");
  });

  it("DATA_READ już włączony → brak set-iam-policy", () => {
    const r = lg(APPLY, { auditPresent: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.map(strip).filter((c) => /set-iam-policy/.test(c))).toEqual([]);
    expect(r.stdout).toContain("  skip: secretmanager.googleapis.com DATA_READ already enabled");
  });
});

describe("P8 (4): zasobnik audytu 365 dni i ujście", () => {
  it("brak zasobnika i ujścia → create w europe-central2, retencja 365, dokładny filtr", () => {
    const calls = lg(APPLY).calls.map(strip);
    expect(calls.filter((c) => /^logging buckets create /.test(c))).toEqual([
      `logging buckets create myhelper-audit --location=${REGION} --retention-days=365`,
    ]);
    expect(calls.filter((c) => /^logging sinks create /.test(c))).toEqual([
      `logging sinks create myhelper-audit-sink ${AUDIT_DEST} --log-filter=${AUDIT_FILTER}`,
    ]);
  });

  it("zasoby istnieją → update z tymi samymi wartościami, bez create", () => {
    const calls = lg(APPLY, { exists: true, auditPresent: true }).calls.map(strip);
    expect(calls.filter((c) => / create /.test(` ${c} `))).toEqual([]);
    expect(calls).toContain(`logging buckets update myhelper-audit --location=${REGION} --retention-days=365`);
    expect(calls).toContain(`logging sinks update myhelper-audit-sink ${AUDIT_DEST} --log-filter=${AUDIT_FILTER}`);
  });

  it("kolejność zmian z --apply: (1) wykluczenie, (2) retencja, (3) audyt, (4) zasobnik, ujście", () => {
    const m = lg(APPLY)
      .calls.map(strip)
      .filter((c) => MUTATING.test(` ${c} `));
    expect(m.map((c) => c.split(" ").slice(0, 4).join(" "))).toEqual([
      "logging sinks update _Default",
      "logging buckets update _Default",
      `projects set-iam-policy ${PROJECT} ${m[2]?.split(" ")[3]}`,
      "logging buckets create myhelper-audit",
      "logging sinks create myhelper-audit-sink",
    ]);
  });
});

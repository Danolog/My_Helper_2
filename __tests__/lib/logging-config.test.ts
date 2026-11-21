// @vitest-environment node
/**
 * Strażnik konfiguracji logów: infra/gcp/logging.sh.
 * Skrypt jest uruchamiany z podstawionym `gcloud` (zapisuje argumenty i treść
 * pliku polityki IAM), więc testy sprawdzają ZACHOWANIE:
 *  - domyślnie dry-run: zero wywołań gcloud, także odczytów;
 *  - każde wywołanie idzie z --project i --quiet; jedyne wywołanie w kodzie to tablica GC;
 *  - odczyt ujścia _Default przed jakąkolwiek zmianą;
 *  - (0) zasobnik myhelper-logs wyłącznie w europe-central2, retencja 30 dni;
 *  - (1) ujście _Default: dokładny cel myhelper-logs i DOKŁADNE wyrażenie filtru
 *    (tylko adres żądania, z kotwicą, bez Referer, disabled=false), zgodne ze
 *    ścieżkami tokenów w zainstalowanym Better Auth; adresy, które tylko
 *    wspominają ścieżkę resetu w parametrach albo we fragmencie, zostają w logach;
 *    token resetu = jeden segment alfabetu generateId (bez `..`, `%2e%2e`);
 *    wykluczane wyłącznie GET;
 *  - --apply odmawia (kod 2, zero wywołań gcloud), gdy next.config.ts w repo
 *    nie ustawia Referrer-Policy: no-referrer dla ścieżek z tokenem; dry-run
 *    działa i wypisuje wynik sprawdzenia;
 *  - (2) retencja _Default = 30 dni jawnie;
 *  - (3) Data Access DATA_READ dla secretmanager.googleapis.com: zmienia się
 *    wyłącznie auditConfigs, wiązania i etag bez zmian, polityka (z adresami
 *    kont) nie trafia do wyjścia ani do lokalnego logu gcloud; błędy odczytu,
 *    zapisu i kształtu polityki zatrzymują przebieg przed (4), a katalog
 *    tymczasowy jest usuwany;
 *  - (4) zasobnik audytu w europe-central2 z retencją 365 dni + ujście
 *    audytu Secret Manager i Admin Activity;
 *  - brak add-iam-policy-binding, brak usuwania, brak blokady retencji.
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/** Wyrażenie RE2 adresu z tokenem (dosłownie jak w skrypcie). */
const TOKEN_RE =
  "^https?://[^/?#]+/(api/auth/verify-email[?]|api/auth/reset-password/[A-Za-z0-9]+([?]|$)|reset-password/?[?])";
const EXCLUSION_FILTER = `httpRequest.requestMethod="GET" AND httpRequest.requestUrl=~"${TOKEN_RE}"`;
const LOGS_DEST = `logging.googleapis.com/projects/${PROJECT}/locations/${REGION}/buckets/myhelper-logs`;
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
const { etag: _etag, ...POLICY_NO_ETAG } = POLICY;
writeFileSync(join(DIR, "policy-no-etag.json"), JSON.stringify(POLICY_NO_ETAG));
// Nieprawidłowy JSON z adresem konta: błąd JSON.parse w node cytuje fragment wejścia.
writeFileSync(join(DIR, "policy-broken.json"), `{"etag":"x","bindings":[{"members":[user:${EMAIL}]}]`);

writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case " $* " in
  *" get-iam-policy "*)
    printf 'nolog-get=%s\\n---\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING:-}" >> "$FAKE_FILES"
    [ -n "$FAKE_READ_ERROR" ] && { echo "ERROR: PERMISSION_DENIED $FAKE_EMAIL" >&2; exit 1; }
    [ -n "$FAKE_IAM_READ_ERROR" ] && { echo "ERROR: PERMISSION_DENIED user:$FAKE_EMAIL" >&2; exit 1; }
    cat "$FAKE_POLICY"; exit 0 ;;
  *" set-iam-policy "*)
    printf 'nolog-set=%s\\n---\\n' "\${CLOUDSDK_CORE_DISABLE_FILE_LOGGING:-}" >> "$FAKE_FILES"
    for a in "$@"; do last="$a"; done
    cat "$last" >> "$FAKE_FILES"; printf '\\n---\\n' >> "$FAKE_FILES"
    [ -n "$FAKE_SET_ERROR" ] && { echo "bindings: - members: [user:$FAKE_EMAIL]"; echo "ERROR: ABORTED: 409 etag mismatch, user:$FAKE_EMAIL" >&2; exit 1; }
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

// Warunek --apply: next.config.ts w repo z no-referrer dla ścieżek z tokenem.
// Skrypt czyta next.config.ts z katalogu ../../ względem siebie, więc przebiegi
// --apply idą z kopii skryptu w drzewie testowym z wybraną treścią konfiguracji.
const NEXT_OK = `const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/reset-password",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
      { source: "/api/auth/reset-password/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/api/auth/verify-email", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};
export default nextConfig;
`;
const VERIFY_LINE =
  '      { source: "/api/auth/verify-email", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },\n';
const CATCH_ALL = NEXT_OK.slice(NEXT_OK.indexOf("      {\n        source: \"/(.*)\""), NEXT_OK.indexOf("      {\n        source: \"/reset-password\""));

/** Kopia skryptu w drzewie DIR/<name>/infra/gcp z next.config.ts (null = brak pliku). */
function repoWith(name: string, nextConfig: string | null, source = SOURCE): string {
  const root = join(DIR, `repo-${name}`);
  mkdirSync(join(root, "infra/gcp"), { recursive: true });
  if (nextConfig !== null) writeFileSync(join(root, "next.config.ts"), nextConfig);
  const script = join(root, "infra/gcp/logging.sh");
  writeFileSync(script, source);
  return script;
}
const SCRIPT_OK = repoWith("ok", NEXT_OK);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
  files: string;
  /** Zawartość TMPDIR przebiegu po jego zakończeniu (ma być pusta). */
  tmpLeft: string[];
}

let n = 0;
function lg(
  args: string[],
  opts: {
    exists?: boolean;
    auditPresent?: boolean;
    readError?: boolean;
    iamReadError?: boolean;
    setError?: boolean;
    policy?: "no-etag" | "broken";
    script?: string;
  } = {},
): Run {
  const id = n++;
  const log = join(DIR, `log-${id}`);
  const files = join(DIR, `files-${id}`);
  const tmp = join(DIR, `tmp-${id}`);
  mkdirSync(tmp, { recursive: true });
  for (const f of [log, files]) writeFileSync(f, "");
  const policy = opts.policy ? `policy-${opts.policy}.json` : opts.auditPresent ? "policy-present.json" : "policy.json";
  const r = spawnSync("bash", [opts.script ?? SCRIPT_OK, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${FAKE}:${process.env.PATH}`,
      TMPDIR: tmp,
      FAKE_LOG: log,
      FAKE_FILES: files,
      FAKE_EMAIL: EMAIL,
      FAKE_POLICY: join(DIR, policy),
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
      ...(opts.readError ? { FAKE_READ_ERROR: "1" } : {}),
      ...(opts.iamReadError ? { FAKE_IAM_READ_ERROR: "1" } : {}),
      ...(opts.setError ? { FAKE_SET_ERROR: "1" } : {}),
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
    files: readFileSync(files, "utf8"),
    tmpLeft: readdirSync(tmp),
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
      expect(line).toMatch(/^(mode: |referrer-policy: |\? gcloud |\+ gcloud |  state: |  audit: |  skip: |logging: done$)/);
    }
  });

  it("dry-run wypisuje kroki (0)–(4) w kolejności z §2 P8", () => {
    const plus = lg(P)
      .stdout.split("\n")
      .filter((l) => l.startsWith("+ gcloud "))
      .map((l) => l.replace(`+ gcloud --project=${PROJECT} --quiet `, ""));
    expect(plus.map((c) => c.split(" ").slice(0, 4).join(" "))).toEqual([
      "logging buckets create myhelper-logs",
      "logging sinks update _Default",
      "logging buckets update _Default",
      `projects set-iam-policy ${PROJECT} <policy-file>`,
      "logging buckets create myhelper-audit",
      "logging sinks create myhelper-audit-sink",
    ]);
  });

  it("dry-run: pierwsze polecenie to odczyt ujścia _Default, przed (0)", () => {
    const lines = lg(P).stdout.split("\n");
    const first = lines.findIndex((l) => l.startsWith("? gcloud ") || l.startsWith("+ gcloud "));
    expect(lines[first]).toBe(`? gcloud --project=${PROJECT} --quiet logging sinks describe _Default --format=value(exclusions[].name)`);
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

  it("region: lokalizacja wyłącznie europe-central2, jedyny wyjątek to buckets update _Default (global z natury)", () => {
    expect(SOURCE.match(/\b(europe|us|asia|me|africa|northamerica|southamerica|australia)-[a-z]+\d\b/g)?.every((x) => x === REGION)).toBe(true);
    for (const o of [{}, { exists: true, auditPresent: true }]) {
      for (const c of lg(APPLY, o).calls.map(strip)) {
        if (/^logging buckets update _Default /.test(c)) {
          expect(c).toBe("logging buckets update _Default --location=global --retention-days=30");
          continue;
        }
        expect(c, c).not.toContain("global");
        expect(c, c).not.toMatch(/ --(region|location)=(?!europe-central2( |$))/);
      }
    }
    const globalLines = CODE.split("\n").filter((l) => /global/.test(l));
    expect(globalLines).toEqual(['  run logging buckets update _Default --location=global "--retention-days=${DEFAULT_RETENTION_DAYS}"']);
  });

  it("w kodzie brak adresów e-mail", () => {
    expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });
});

describe("P8 (0): zasobnik myhelper-logs (cel ujścia _Default)", () => {
  it("brak zasobnika → create wyłącznie w europe-central2 z retencją 30 dni", () => {
    const c = lg(APPLY).calls.map(strip).filter((x) => / myhelper-logs /.test(` ${x} `) && !/ describe /.test(` ${x} `));
    expect(c).toEqual([`logging buckets create myhelper-logs --location=${REGION} --retention-days=30`]);
  });

  it("zasobnik istnieje → update z tymi samymi wartościami, bez create", () => {
    const c = lg(APPLY, { exists: true, auditPresent: true }).calls.map(strip).filter((x) => / myhelper-logs /.test(` ${x} `) && !/ describe /.test(` ${x} `));
    expect(c).toEqual([`logging buckets update myhelper-logs --location=${REGION} --retention-days=30`]);
  });

  it("myhelper-logs w kodzie tylko z --location=${REGION} i retencją DEFAULT_RETENTION_DAYS=30", () => {
    expect(SOURCE).toContain('LOGS_BUCKET="myhelper-logs"');
    expect(SOURCE).toContain("DEFAULT_RETENTION_DAYS=30\n");
    expect(SOURCE).toContain('LOGS_DEST="logging.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/buckets/${LOGS_BUCKET}"');
    for (const l of CODE.split("\n").filter((x) => /\$LOGS_BUCKET/.test(x))) {
      expect(l).toContain('"--location=${REGION}"');
    }
  });
});

describe("P8 (1): ujście _Default — cel myhelper-logs i filtr wykluczający tokeny", () => {
  it("dokładne wyrażenie filtru w kodzie: tylko adres żądania, bez Referer", () => {
    expect(SOURCE).toContain(`TOKEN_RE='${TOKEN_RE}'`);
    expect(SOURCE).toContain(
      'EXCLUSION_FILTER="httpRequest.requestMethod=\\"GET\\" AND httpRequest.requestUrl=~\\"${TOKEN_RE}\\""\n',
    );
  });

  it("filtr nie sprawdza nagłówka Referer (wartość ustala klient)", () => {
    expect(EXCLUSION_FILTER).not.toMatch(/referer/i);
    expect(CODE).not.toMatch(/referer/i);
  });

  it("brak wykluczenia → cel myhelper-logs i --add-exclusion z dokładnym filtrem, disabled=false", () => {
    const c = lg(APPLY).calls.map(strip).filter((x) => /^logging sinks update _Default /.test(x));
    expect(c).toEqual([
      `logging sinks update _Default ${LOGS_DEST} --add-exclusion=name=myhelper-auth-token-urls,filter=${EXCLUSION_FILTER},disabled=false`,
    ]);
  });

  it("wykluczenie istnieje → ten sam cel i --update-exclusion z tym samym filtrem, disabled=false (bez dryfu)", () => {
    const c = lg(APPLY, { exists: true, auditPresent: true }).calls.map(strip).filter((x) => /^logging sinks update _Default /.test(x));
    expect(c).toEqual([
      `logging sinks update _Default ${LOGS_DEST} --update-exclusion=name=myhelper-auth-token-urls,filter=${EXCLUSION_FILTER},disabled=false`,
    ]);
  });

  it("filtr nie ma przecinka (rozdziela pola --add-exclusion) ani `\\`", () => {
    expect(EXCLUSION_FILTER).not.toContain(",");
    expect(TOKEN_RE).not.toContain("\\");
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
    "https://h/reset-password?error=invalid_token",
    "https://app.nordsignal.cc/reset-password/?token=AbCdEf123456",
    "https://app.nordsignal.cc/reset-password?token=AbCdEf123456&_rsc=1x2y3",
    "http://app.nordsignal.cc/reset-password?token=AbCdEf123456",
    "https://app.nordsignal.cc:443/api/auth/verify-email?token=eyJhbGciOi.x.y",
    "https://app.nordsignal.cc/api/auth/reset-password/AbCdEf123456",
  ])("obejmuje adres z tokenem: %s", (url) => {
    expect(re.test(url)).toBe(true);
  });

  // Wpis ma ZOSTAĆ w logach: ścieżka resetu tylko w parametrach albo we
  // fragmencie (od klienta), POST resetu z tokenem w treści, inna ścieżka.
  it.each([
    "https://app.nordsignal.cc/api/auth/sign-in/email",
    "https://app.nordsignal.cc/api/auth/request-password-reset",
    "https://app.nordsignal.cc/api/auth/get-session",
    "https://app.nordsignal.cc/api/auth/callback/google?code=x&state=y",
    "https://app.nordsignal.cc/forgot-password",
    "https://app.nordsignal.cc/api/health",
    "https://app.nordsignal.cc/login?callbackURL=%2Freset-password",
    "https://h/api/auth/sign-in/email?x=/reset-password",
    "https://h/api/auth/sign-in/email?x=/api/auth/verify-email?token=1",
    "https://h/login?callbackURL=/reset-password",
    "https://h/api/auth/reset-password",
    "https://h/x/reset-password?token=1",
    "https://h/api/health#/reset-password?",
    "https://h/api/health?x=/reset-password",
    "https://h/api/auth/verify-email",
    "/reset-password?token=1",
    // Segmenty kropkowe i kodowanie po prefiksie resetu: po normalizacji inna
    // ścieżka (np. logowanie) — wpis zostaje.
    "https://h/api/auth/reset-password/../sign-in/email",
    "https://h/api/auth/reset-password/..",
    "https://h/api/auth/reset-password/%2e%2e/sign-in/email",
    "https://h/api/auth/reset-password/%2E%2E%2Fsign-in%2Femail",
    "https://h/api/auth/reset-password/.%2e/sign-in/email?x=1",
    "https://h/api/auth/reset-password/AbC123/../../sign-in/email",
    "https://h/api/auth/reset-password/AbC123/../../sign-in/email?callbackURL=%2F",
    "https://h/api/auth/reset-password/AbC123%2F..%2F..%2Fsign-in%2Femail",
    "https://h/api/auth/reset-password/AbC.123?callbackURL=%2F",
    "https://h/api/auth/reset-password/AbC123/",
    "https://h/api/auth/reset-password/AbC123;x=1",
    "https://h/api/auth/reset-password/?callbackURL=%2F",
    "https://h/api/auth/reset-password//?callbackURL=%2F",
    "https://h/api/auth/reset-password/AbC_123?callbackURL=%2F",
  ])("nie obejmuje (wpis zostaje): %s", (url) => {
    expect(re.test(url)).toBe(false);
  });

  // Ocena całego filtru (metoda AND adres) na wpisie żądania.
  const parsed = /^httpRequest\.requestMethod="([A-Z]+)" AND httpRequest\.requestUrl=~"(.*)"$/.exec(EXCLUSION_FILTER);
  const excluded = (method: string, url: string) =>
    parsed !== null && method === parsed[1] && new RegExp(parsed[2]!).test(url);

  it("filtr ma postać: metoda GET AND adres (jedna klauzula metody, bez OR)", () => {
    expect(parsed).not.toBeNull();
    expect(parsed![1]).toBe("GET");
    expect(parsed![2]).toBe(TOKEN_RE);
    expect(EXCLUSION_FILTER).not.toMatch(/\bOR\b|\bNOT\b|-httpRequest/);
  });

  it.each([
    ["GET", "https://h/api/auth/verify-email?token=eyJ.x.y&callbackURL=%2F", true],
    ["GET", "https://h/api/auth/reset-password/AbCdEf123456?callbackURL=%2F", true],
    ["GET", "https://h/reset-password?token=AbCdEf123456", true],
    ["POST", "https://h/api/auth/reset-password/AbCdEf123456?callbackURL=%2F", false],
    ["POST", "https://h/api/auth/verify-email?token=1", false],
    ["POST", "https://h/reset-password?token=AbCdEf123456", false],
    ["POST", "https://h/api/auth/reset-password", false],
    ["PUT", "https://h/api/auth/reset-password/AbCdEf123456", false],
    ["HEAD", "https://h/api/auth/reset-password/AbCdEf123456", false],
    ["get", "https://h/api/auth/reset-password/AbCdEf123456", false],
    ["GET", "https://h/api/auth/reset-password/../sign-in/email", false],
    ["GET", "https://h/api/auth/reset-password/%2e%2e/sign-in/email", false],
    ["POST", "https://h/api/auth/reset-password/../sign-in/email", false],
  ])("%s %s → wykluczony: %s", (method, url, want) => {
    expect(excluded(method, url)).toBe(want);
  });

  // Alfabet tokenu resetu = alfabet generateId w zainstalowanym @better-auth/core.
  // Zmiana alfabetu albo długości po aktualizacji zatrzymuje test, zanim token
  // z nowym znakiem (np. `_`/`-`) przestanie być wykluczany.
  it("token resetu: generateId(24) z alfabetu a-z, A-Z, 0-9 — segment filtru go obejmuje", () => {
    const pw = readFileSync(join(ROOT, "node_modules/better-auth/dist/api/routes/password.mjs"), "utf8");
    expect(pw).toContain('import { generateId } from "@better-auth/core/utils/id";');
    expect(pw).toContain("const verificationToken = generateId(24);");
    const sibling = join(realpathSync(join(ROOT, "node_modules/better-auth")), "../@better-auth/core/dist/utils/id.mjs");
    const hoisted = join(ROOT, "node_modules/.pnpm/node_modules/@better-auth/core/dist/utils/id.mjs");
    const idSrc = readFileSync(existsSync(sibling) ? sibling : hoisted, "utf8");
    expect(idSrc).toContain('return createRandomStringGenerator("a-z", "A-Z", "0-9")(size || 32);');
    const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < 200; i++) {
      let t = "";
      for (let j = 0; j < 24; j++) t += ALPHA[randomInt(ALPHA.length)];
      expect(excluded("GET", `https://h/api/auth/reset-password/${t}?callbackURL=%2Freset-password`), t).toBe(true);
    }
    // Każdy znak alfabetu przynajmniej raz.
    expect(excluded("GET", `https://h/api/auth/reset-password/${ALPHA}?callbackURL=%2F`)).toBe(true);
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
    // baseURL Better Auth = <origin>/api/auth; strona resetu = <origin>/reset-password.
    for (const p of ["/api/auth/reset-password/T?callbackURL=%2F", "/api/auth/verify-email?token=T&callbackURL=%2F", "/reset-password?token=T"]) {
      for (const origin of ["https://app.nordsignal.cc", "https://myhelper-xyz-lm.a.run.app", "http://app.nordsignal.cc"]) {
        expect(re.test(origin + p), origin + p).toBe(true);
      }
    }
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
    expect(calls.filter((c) => /^logging buckets create myhelper-audit /.test(c))).toEqual([
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

  it("kolejność zmian z --apply: (0) myhelper-logs, (1) ujście _Default, (2) retencja, (3) audyt, (4) zasobnik, ujście", () => {
    for (const [o, verb] of [
      [{}, "create"],
      [{ exists: true }, "update"],
    ] as const) {
      const calls = lg(APPLY, o).calls.map(strip);
      expect(calls[0]).toBe("logging sinks describe _Default --format=value(exclusions[].name)");
      const m = calls.filter((c) => MUTATING.test(` ${c} `));
      expect(m.map((c) => c.split(" ").slice(0, 4).join(" "))).toEqual([
        `logging buckets ${verb} myhelper-logs`,
        "logging sinks update _Default",
        "logging buckets update _Default",
        `projects set-iam-policy ${PROJECT} ${m[3]?.split(" ")[3]}`,
        `logging buckets ${verb} myhelper-audit`,
        `logging sinks ${verb} myhelper-audit-sink`,
      ]);
    }
  });
});

describe("P8 (3): ścieżki błędów IAM i sprzątanie katalogu tymczasowego", () => {
  const STEP4 = /myhelper-audit/;

  it("udany przebieg: katalog tymczasowy z polityką usunięty", () => {
    const r = lg(APPLY);
    expect(r.status, r.stderr).toBe(0);
    expect(r.tmpLeft).toEqual([]);
  });

  it.each([
    ["błąd odczytu polityki IAM", { iamReadError: true }, "cannot read IAM policy"],
    ["odmowa zapisu (konflikt etag 409)", { setError: true }, "cannot set audit config"],
    ["polityka bez etag", { policy: "no-etag" as const }, "unexpected IAM policy shape"],
    ["nieprawidłowy JSON polityki (node cytuje wejście)", { policy: "broken" as const }, "cannot prepare audit config"],
  ])("%s → kod 2, brak kroku (4), brak adresów kont w wyjściu, katalog usunięty", (_l, o, msg) => {
    const r = lg(APPLY, o);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(msg);
    expect(r.calls.map(strip).filter((c) => STEP4.test(c))).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain(EMAIL);
    expect(r.tmpLeft).toEqual([]);
  });

  it("błąd odczytu i polityka bez etag → brak set-iam-policy", () => {
    for (const o of [{ iamReadError: true }, { policy: "no-etag" as const }, { policy: "broken" as const }]) {
      expect(lg(APPLY, o).calls.map(strip).filter((c) => /set-iam-policy/.test(c))).toEqual([]);
    }
  });

  it("pułapka EXIT na zmiennej globalnej (nie `local`), bez ręcznego rm katalogu", () => {
    expect(SOURCE).toContain('P8_TMP=""\n');
    expect(SOURCE).toContain(`trap 'rm -rf "\${P8_TMP:-}"' EXIT`);
    expect(CODE).not.toMatch(/local [^\n]*\btmp\b/);
    expect(CODE).toContain('result="$(node - "$before" "$after" "$AUDIT_SERVICE" 2>/dev/null <<\'JS\'');
  });

  // Zmiana kodu node, która ruszyłaby politykę poza auditConfigs, ma zatrzymać
  // przebieg w samym skrypcie (nie tylko w tym teście).
  it("zmiana polityki poza auditConfigs → stop przed set-iam-policy (mutacja skryptu)", () => {
    const anchor = "p.auditConfigs = cfgs;";
    expect(SOURCE.split(anchor)).toHaveLength(2);
    const mutated = repoWith("mutated", NEXT_OK, SOURCE.replace(anchor, `${anchor} p.bindings = [];`));
    const r = lg(APPLY, { script: mutated });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("IAM policy would change outside auditConfigs");
    expect(r.calls.map(strip).filter((c) => /set-iam-policy|myhelper-audit/.test(c))).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain(EMAIL);
    expect(r.tmpLeft).toEqual([]);
  });
});

describe("P8: --apply odmawia bez Referrer-Policy: no-referrer w next.config.ts", () => {
  it("stałe w kodzie: next.config.ts z katalogu repo skryptu, trzy ścieżki z tokenem", () => {
    expect(SOURCE).toContain('REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"\n');
    expect(SOURCE).toContain('NEXT_CONFIG="${REPO_ROOT}/next.config.ts"\n');
    expect(SOURCE).toContain(
      'NO_REFERRER_SOURCES=("/reset-password" "/api/auth/reset-password/:token" "/api/auth/verify-email")\n',
    );
    // Sprawdzenie przed pierwszym odczytem gcloud, w obu trybach.
    const main = CODE.slice(CODE.lastIndexOf('if [[ "$APPLY" == 1 ]]; then\n  echo "mode: APPLY'));
    expect(main.indexOf("referrer_guard\n")).toBeGreaterThan(0);
    expect(main.indexOf("referrer_guard\n")).toBeLessThan(main.indexOf("read_default_sink\n"));
    // Brak zmiennej środowiska ani flagi omijającej sprawdzenie.
    expect(CODE).not.toMatch(/NEXT_CONFIG=\$\{|--skip|--force|--no-check/);
  });

  it("konfiguracja z no-referrer → --apply przechodzi, wyjście „referrer-policy: ok”", () => {
    const r = lg(APPLY);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("referrer-policy: ok");
    expect(r.calls.length).toBeGreaterThan(0);
  });

  it("key i value w jednej linii też przechodzą (wpisy /api/auth/* w NEXT_OK)", () => {
    expect(NEXT_OK).toContain(VERIFY_LINE);
    expect(lg(APPLY).status).toBe(0);
  });

  const BEFORE = NEXT_OK.replace(CATCH_ALL, "").replace("    ];\n", `${CATCH_ALL}    ];\n`);
  it.each([
    ["brak pliku next.config.ts", null, "/reset-password /api/auth/reset-password/:token /api/auth/verify-email"],
    ["brak wpisu /api/auth/verify-email", NEXT_OK.replace(VERIFY_LINE, ""), "/api/auth/verify-email"],
    ["wpis zakomentowany", NEXT_OK.replace(VERIFY_LINE, `// ${VERIFY_LINE}`), "/api/auth/verify-email"],
    [
      "no-referrer-when-downgrade zamiast no-referrer",
      NEXT_OK.replace('            value: "no-referrer",', '            value: "no-referrer-when-downgrade",'),
      "/reset-password",
    ],
    [
      "no-referrer w innym nagłówku",
      NEXT_OK.replace(VERIFY_LINE, VERIFY_LINE.replace('key: "Referrer-Policy"', 'key: "X-Other"')),
      "/api/auth/verify-email",
    ],
    ["wpisy przed \"/(.*)\" (ostatni wygrywa)", BEFORE, "/reset-password /api/auth/reset-password/:token /api/auth/verify-email"],
    [
      "dzisiejszy kształt: tylko strict-origin-when-cross-origin na \"/(.*)\"",
      `${NEXT_OK.slice(0, NEXT_OK.indexOf(CATCH_ALL) + CATCH_ALL.length)}    ];\n  },\n};\n`,
      "/reset-password /api/auth/reset-password/:token /api/auth/verify-email",
    ],
  ])("%s → --apply: kod 2 przed pierwszym gcloud; dry-run: kod 0 z informacją", (name, cfg, missing) => {
    if (cfg !== null) expect(cfg, "wariant musi różnić się od NEXT_OK").not.toBe(NEXT_OK);
    const script = repoWith(`bad-${name.replace(/[^a-z0-9]+/gi, "-")}`, cfg);
    const a = lg(APPLY, { script });
    expect(a.status).toBe(2);
    expect(a.calls).toEqual([]);
    expect(a.stderr).toContain(`error: --apply refused: next.config.ts must set Referrer-Policy: no-referrer for: ${missing}`);
    const d = lg(P, { script });
    expect(d.status, d.stderr).toBe(0);
    expect(d.calls).toEqual([]);
    expect(d.stdout).toContain(`referrer-policy: missing no-referrer in next.config.ts for: ${missing}\n`);
    expect(d.stdout).toMatch(/\nlogging: done\n$/);
  });

  it("skrypt w repo: wynik sprawdzenia zgodny z next.config.ts repo (odmowa bez gcloud albo ok)", () => {
    const a = lg(APPLY, { script: SCRIPT });
    if (a.stdout.includes("referrer-policy: ok")) {
      expect(a.status, a.stderr).toBe(0);
    } else {
      expect(a.status).toBe(2);
      expect(a.calls).toEqual([]);
      expect(a.stderr).toContain("--apply refused");
    }
    const d = lg(P, { script: SCRIPT });
    expect(d.status, d.stderr).toBe(0);
    expect(d.calls).toEqual([]);
    expect(d.stdout).toMatch(/\nreferrer-policy: (ok|missing) /);
  });
});

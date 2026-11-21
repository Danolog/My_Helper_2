// @vitest-environment node
/**
 * Strażnik konfiguracji LB: infra/gcp/lb.sh —
 * regionalny load balancer HTTPS przed Cloud Run `myhelper`.
 * Skrypt jest uruchamiany z podstawionym `gcloud` (zapisuje argumenty i treść
 * plików --source/--policy-from-file), więc testy sprawdzają ZACHOWANIE:
 *  - domyślnie dry-run: zero wywołań gcloud, także odczytów (tworzenie i --teardown);
 *  - każde wywołanie idzie z --project i --quiet; jedyne wywołanie w kodzie to tablica GC;
 *  - region wyłącznie europe-central2; zasoby regionalne bez `--global`;
 *  - stałe nazwy zasobów (nieprzełączalne z linii poleceń);
 *  - kolejność tworzenia 1–12 z §2 P1, --teardown w odwrotnej kolejności;
 *  - podsieć proxy-only REGIONAL_MANAGED_PROXY/ACTIVE; IP i obie reguły w jednym tierze;
 *  - backend z logowaniem; ssl-policy MODERN + TLS 1.2 na proxy HTTPS;
 *  - certyfikat Google-managed przez autoryzację DNS w europe-central2;
 *  - 80 → 301 na https; uptime check https /api/health co 1 min;
 *    adres powiadomień tylko z parametru/zmiennej, nigdy w wyjściu ani w repo;
 *  - brak `add-iam-policy-binding`, brak zmian usługi Cloud Run (ingress `all`);
 *  - idempotencja: istniejące zasoby nie są tworzone ponownie.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/lb.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
/** Kod bez linii komentarza (komentarze nazywają zakazy, np. add-iam-policy-binding). */
const CODE = SOURCE.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const PROJECT = "my-helper-2-488419";
const EMAIL = "wlasciciel-testowy@example.invalid";
const REGION = "europe-central2";

const DIR = mkdtempSync(join(tmpdir(), "p1-lb-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const FAKE = join(DIR, "bin");
mkdirSync(FAKE, { recursive: true });
writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
for a in "$@"; do
  case "$a" in
    --source=*|--policy-from-file=*) cat "\${a#*=}" >> "$FAKE_FILES"; printf '\\n---\\n' >> "$FAKE_FILES" ;;
  esac
done
case " $* " in
  *" addresses describe "*"value(address)"*) echo "203.0.113.10"; exit 0 ;;
  *" dns-authorizations describe "*"dnsResourceRecord"*)
    printf '_acme-challenge_abc.app.nordsignal.cc.\\tCNAME\\tabc.1.authorize.certificatemanager.goog.\\n'; exit 0 ;;
  *" backend-services describe "*"backends"*)
    [ -n "$FAKE_EXISTS" ] && echo "https://www.googleapis.com/compute/v1/projects/p/regions/${REGION}/networkEndpointGroups/myhelper-lb-neg"
    exit 0 ;;
  *" list "*|*" list-configs "*)
    [ -n "$FAKE_LIST_ERROR" ] && { echo "ERROR: PERMISSION_DENIED" >&2; exit 1; }
    [ -n "$FAKE_EXISTS" ] && echo "projects/p/x/fake-1"
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
function lb(args: string[], opts: { exists?: boolean; listError?: boolean; env?: Record<string, string> } = {}): Run {
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
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
      ...(opts.listError ? { FAKE_LIST_ERROR: "1" } : {}),
      ...opts.env,
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
const APPLY = [...P, `--notify-email=${EMAIL}`, "--apply"];
const TEARDOWN = [...P, "--teardown", "--apply"];
const MUTATING = / (create|import|add-backend|update|delete|enable) /;

// Kolejność z §2 P1 (1)–(12): wzorce wywołań zmieniających.
const CREATE_ORDER: [string, RegExp][] = [
  ["(1) API", /^services enable .*compute\.googleapis\.com.*certificatemanager\.googleapis\.com/],
  ["(2) VPC", /^compute networks create myhelper-lb-vpc /],
  ["(2) proxy-only", /^compute networks subnets create myhelper-lb-proxy-only /],
  ["(3) IP", /^compute addresses create myhelper-lb-ip /],
  ["(4) NEG", /^compute network-endpoint-groups create myhelper-lb-neg /],
  ["(5) backend", /^compute backend-services create myhelper-lb-backend /],
  ["(5) backend NEG", /^compute backend-services add-backend myhelper-lb-backend /],
  ["(6) URL map", /^compute url-maps create myhelper-lb-https /],
  ["(7) autoryzacja DNS", /^certificate-manager dns-authorizations create myhelper-lb-dnsauth /],
  ["(7) certyfikat", /^certificate-manager certificates create myhelper-lb-cert /],
  ["(8) ssl-policy", /^compute ssl-policies create myhelper-lb-tls12 /],
  ["(9) proxy HTTPS", /^compute target-https-proxies create myhelper-lb-https-proxy /],
  ["(10) reguła 443", /^compute forwarding-rules create myhelper-lb-https-fr /],
  ["(11) URL map 80", /^compute url-maps import myhelper-lb-http-redirect /],
  ["(11) proxy HTTP", /^compute target-http-proxies create myhelper-lb-http-proxy /],
  ["(11) reguła 80", /^compute forwarding-rules create myhelper-lb-http-fr /],
  ["(12) uptime check", /^monitoring uptime create myhelper-app-health /],
  ["(12) kanał e-mail", /^beta monitoring channels create /],
  ["(12) alert", /^alpha monitoring policies create /],
];

const strip = (c: string) => c.replace(`--project=${PROJECT} --quiet `, "");

describe("P1: dry-run i parametry", () => {
  it.each([
    ["tworzenie", P],
    ["tworzenie z adresem", [...P, `--notify-email=${EMAIL}`]],
    ["teardown", [...P, "--teardown"]],
    ["--project ze spacją (wiersz z runbooka)", ["--project", PROJECT]],
  ])("%s: domyślnie dry-run — zero wywołań gcloud, także odczytów", (_l, args) => {
    const r = lb(args);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stdout).toMatch(/\nlb (create|teardown): done\n$/);
  });

  it("jawne --dry-run po --apply wygrywa i nic nie wykonuje", () => {
    expect(lb([...APPLY, "--dry-run"]).calls).toEqual([]);
    expect(lb([...TEARDOWN, "--dry-run"]).calls).toEqual([]);
  });

  it("wyjście dry-run to wyłącznie polecenia, odczyty stanu i treść plików", () => {
    for (const args of [P, [...P, "--teardown"]]) {
      for (const line of lb(args).stdout.split("\n").filter(Boolean)) {
        expect(line).toMatch(/^(mode: |\? gcloud |\+ gcloud |  state: |  urlmap: |  policy: |  dns: |  skip: |  LB_IP=|lb (create|teardown): done$)/);
      }
    }
  });

  it("dry-run wypisuje każdy krok (1)–(12) w kolejności z §2 P1", () => {
    const plus = lb(P)
      .stdout.split("\n")
      .filter((l) => l.startsWith("+ gcloud "))
      .map((l) => l.replace(`+ gcloud --project=${PROJECT} --quiet `, ""));
    const idx = CREATE_ORDER.map(([label, re]) => [label, plus.findIndex((c) => re.test(c))] as const);
    for (const [label, i] of idx) expect(i, label).toBeGreaterThanOrEqual(0);
    const order = idx.map(([, i]) => i);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each([
    ["bez --project", ["--apply"]],
    ["nieprawidłowy projekt", ["--project=Bad_Project", "--apply"]],
    ["region spoza allowlisty", [...APPLY, "--region=europe-west1"]],
    ["region us-central1", [...APPLY, "--region=us-central1"]],
    ["nieznany argument", [...APPLY, "--force"]],
    ["nazwa zasobu z linii poleceń", [...APPLY, "--backend=inny"]],
    ["inna domena", [...APPLY, "--domain=evil.example.com"]],
    ["inna usługa", [...APPLY, "--service=inna"]],
    ["--apply bez adresu powiadomień", [...P, "--apply"]],
    ["nieprawidłowy adres", [...P, "--notify-email=nie-adres", "--apply"]],
    ["--global", [...APPLY, "--global"]],
  ])("%s → błąd przed pierwszym gcloud", (_l, args) => {
    const r = lb(args);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it("jawny --region=europe-central2 jest przyjmowany", () => {
    expect(lb([...APPLY, `--region=${REGION}`]).status).toBe(0);
  });
});

describe("P1: każde wywołanie przez GC (--project, --quiet)", () => {
  it.each([
    ["tworzenie", APPLY, false],
    ["tworzenie, zasoby istnieją", APPLY, true],
    ["teardown", TEARDOWN, true],
  ])("%s z --apply", (_l, args, exists) => {
    const r = lb(args as string[], { exists: exists as boolean });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.length).toBeGreaterThan(0);
    for (const c of r.calls) expect(c.startsWith(`--project=${PROJECT} --quiet `), c).toBe(true);
  });

  it("w kodzie jedyne wywołanie gcloud to tablica GC (reszta to echo)", () => {
    const lines = SOURCE.split("\n").filter((l) => /\bgcloud\b/.test(l) && !l.trim().startsWith("#"));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$|^\s*echo "[+?] gcloud /);
  });

  it("w kodzie brak gsutil, curl, wget, vercel, wrangler", () => {
    expect(SOURCE).not.toMatch(/\b(gsutil|curl|wget|vercel|wrangler)\b/);
  });
});

describe("P1: region, --global, stałe nazwy", () => {
  const all = [...lb(APPLY).calls, ...lb(TEARDOWN, { exists: true }).calls].map(strip);

  it("zasoby regionalne: każde wywołanie compute/certificate-manager ma europe-central2 i nie ma --global", () => {
    const regional = all.filter((c) => /^(compute|certificate-manager) /.test(c));
    expect(regional.length).toBeGreaterThan(20);
    for (const c of regional) {
      if (/^compute networks (create|delete|describe) /.test(c)) continue; // sieć VPC jest zasobem globalnym z natury
      expect(c, c).toMatch(/ --(region|location)=europe-central2( |$)/);
    }
    for (const c of all) {
      expect(c, c).not.toMatch(/(^| )--global( |$)/);
      expect(c, c).not.toMatch(/ --[a-z-]*(region|location)s?=(?!europe-central2( |$|,))/);
    }
  });

  it("w kodzie brak `--global` i inny region niż europe-central2", () => {
    expect(SOURCE).not.toMatch(/--global\b/);
    expect(SOURCE.match(/\b(europe|us|asia|me|africa|northamerica|southamerica|australia)-[a-z]+\d\b/g)?.every((r) => r === REGION)).toBe(true);
  });

  it("utworzone zasoby mają dokładnie stałe nazwy", () => {
    const names = lb(APPLY)
      .calls.map(strip)
      .filter((c) => / (create|import) /.test(c) && !/^(beta|alpha) monitoring /.test(c))
      .map((c) => c.match(/ (?:create|import) ([a-z0-9-]+)/)?.[1]);
    expect(names).toEqual([
      "myhelper-lb-vpc",
      "myhelper-lb-proxy-only",
      "myhelper-lb-ip",
      "myhelper-lb-neg",
      "myhelper-lb-backend",
      "myhelper-lb-https",
      "myhelper-lb-dnsauth",
      "myhelper-lb-cert",
      "myhelper-lb-tls12",
      "myhelper-lb-https-proxy",
      "myhelper-lb-https-fr",
      "myhelper-lb-http-redirect",
      "myhelper-lb-http-proxy",
      "myhelper-lb-http-fr",
      "myhelper-app-health",
    ]);
  });
});

describe("P1: zasoby (1)–(11)", () => {
  const r = lb(APPLY);
  const calls = r.calls.map(strip);
  const one = (re: RegExp) => {
    const m = calls.filter((c) => re.test(c));
    expect(m, String(re)).toHaveLength(1);
    return m[0]!;
  };

  it("kolejność tworzenia z --apply zgodna z §2 P1", () => {
    const order = CREATE_ORDER.map(([label, re]) => {
      const i = calls.findIndex((c) => re.test(c));
      expect(i, label).toBeGreaterThanOrEqual(0);
      return i;
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("(1) API compute i certificatemanager (oraz monitoring dla uptime check)", () => {
    const c = one(/^services enable /);
    for (const api of ["compute.googleapis.com", "certificatemanager.googleapis.com", "monitoring.googleapis.com"]) expect(c).toContain(api);
  });

  it("(2) VPC custom + podsieć proxy-only REGIONAL_MANAGED_PROXY / ACTIVE", () => {
    expect(one(/^compute networks create /)).toContain("--subnet-mode=custom");
    const s = one(/^compute networks subnets create /);
    for (const f of ["--purpose=REGIONAL_MANAGED_PROXY", "--role=ACTIVE", "--network=myhelper-lb-vpc", `--region=${REGION}`]) expect(s).toContain(f);
    expect(s).toMatch(/ --range=\d+\.\d+\.\d+\.\d+\/(2[0-3])( |$)/);
  });

  it("(3)+(10)+(11) IP regionalny i obie reguły w tym samym tierze, EXTERNAL_MANAGED, porty 443 i 80", () => {
    const tier = one(/^compute addresses create /).match(/ --network-tier=(PREMIUM|STANDARD)( |$)/)?.[1];
    expect(tier).toBeDefined();
    const fr443 = one(/^compute forwarding-rules create myhelper-lb-https-fr /);
    const fr80 = one(/^compute forwarding-rules create myhelper-lb-http-fr /);
    for (const fr of [fr443, fr80]) {
      expect(fr).toContain(`--network-tier=${tier}`);
      expect(fr).toContain("--load-balancing-scheme=EXTERNAL_MANAGED");
      expect(fr).toContain("--address=myhelper-lb-ip");
      expect(fr).toContain("--network=myhelper-lb-vpc");
    }
    expect(fr443).toMatch(/ --ports=443( |$)/);
    expect(fr443).toContain("--target-https-proxy=myhelper-lb-https-proxy");
    expect(fr80).toMatch(/ --ports=80( |$)/);
    expect(fr80).toContain("--target-http-proxy=myhelper-lb-http-proxy");
    expect(r.stdout).toContain("  LB_IP=203.0.113.10");
  });

  it("(4) serverless NEG → usługa myhelper", () => {
    const c = one(/^compute network-endpoint-groups create /);
    expect(c).toContain("--network-endpoint-type=serverless");
    expect(c).toMatch(/ --cloud-run-service=myhelper( |$)/);
  });

  it("(5) backend EXTERNAL_MANAGED z logowaniem, NEG podpięty", () => {
    const b = one(/^compute backend-services create /);
    expect(b).toContain("--load-balancing-scheme=EXTERNAL_MANAGED");
    expect(b).toMatch(/ --enable-logging( |$)/);
    expect(b).toMatch(/ --logging-sample-rate=1(\.0)?( |$)/);
    const a = one(/^compute backend-services add-backend /);
    expect(a).toContain("--network-endpoint-group=myhelper-lb-neg");
    expect(a).toContain(`--network-endpoint-group-region=${REGION}`);
  });

  it("(6) URL map → backend", () => {
    expect(one(/^compute url-maps create /)).toContain("--default-service=myhelper-lb-backend");
  });

  it("(7) autoryzacja DNS + certyfikat Google-managed w europe-central2; skrypt wypisuje rekord CNAME", () => {
    const d = one(/^certificate-manager dns-authorizations create /);
    expect(d).toContain("--domain=app.nordsignal.cc");
    expect(d).toContain(`--location=${REGION}`);
    const c = one(/^certificate-manager certificates create /);
    expect(c).toContain("--domains=app.nordsignal.cc");
    expect(c).toContain("--dns-authorizations=myhelper-lb-dnsauth");
    expect(c).toContain(`--location=${REGION}`);
    expect(c).not.toMatch(/--certificate-file|--private-key-file|--self-managed/);
    expect(r.stdout).toMatch(/  dns: _acme-challenge_abc\.app\.nordsignal\.cc\.\s+CNAME\s+\S+/);
  });

  it("(8)+(9) ssl-policy MODERN + TLS 1.2 i proxy HTTPS z tą polityką i certyfikatem", () => {
    const s = one(/^compute ssl-policies create /);
    expect(s).toMatch(/ --profile=MODERN( |$)/);
    expect(s).toMatch(/ --min-tls-version=1\.2( |$)/);
    const p = one(/^compute target-https-proxies create /);
    expect(p).toContain("--ssl-policy=myhelper-lb-tls12");
    expect(p).toContain("--url-map=myhelper-lb-https");
    expect(p).toContain(`--certificate-manager-certificates=projects/${PROJECT}/locations/${REGION}/certificates/myhelper-lb-cert`);
  });

  it("(11) URL map 80 to wyłącznie przekierowanie 301 na https", () => {
    expect(one(/^compute url-maps import /)).toContain(`--region=${REGION}`);
    expect(r.files).toMatch(/name: myhelper-lb-http-redirect\ndefaultUrlRedirect:\n {2}httpsRedirect: true\n {2}redirectResponseCode: MOVED_PERMANENTLY_DEFAULT/);
    expect(r.files).not.toMatch(/defaultService/);
    expect(one(/^compute target-http-proxies create /)).toContain("--url-map=myhelper-lb-http-redirect");
  });

  it("brak add-iam-policy-binding i brak zmian usługi Cloud Run (ingress `all`)", () => {
    expect(CODE).not.toMatch(/iam-policy/);
    for (const c of [...calls, ...lb(TEARDOWN, { exists: true }).calls.map(strip)]) {
      expect(c).not.toMatch(/iam-policy|^run /);
    }
  });
});

describe("P1: uptime check i powiadomienie (12)", () => {
  it("uptime check https na app.nordsignal.cc/api/health co 1 min z walidacją certyfikatu", () => {
    const c = lb(APPLY).calls.map(strip).filter((x) => /^monitoring uptime create /.test(x));
    expect(c).toHaveLength(1);
    for (const f of ["--resource-type=uptime-url", "host=app.nordsignal.cc", `project_id=${PROJECT}`, "--protocol=https", "--path=/api/health", "--port=443", "--period=1", "--validate-ssl=true"]) {
      expect(c[0]).toContain(f);
    }
  });

  it("adres powiadomień tylko w wywołaniu kanału; nigdy w wyjściu; w kodzie brak adresów e-mail", () => {
    const r = lb(APPLY);
    expect(r.stdout + r.stderr).not.toContain(EMAIL);
    const withEmail = r.calls.filter((c) => c.includes(EMAIL)).map(strip);
    expect(withEmail).toHaveLength(1);
    expect(withEmail[0]).toMatch(/^beta monitoring channels create .*--type=email .*--channel-labels=email_address=/);
    expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });

  it("adres ze zmiennej LB_NOTIFY_EMAIL działa jak --notify-email", () => {
    const r = lb([...P, "--apply"], { env: { LB_NOTIFY_EMAIL: EMAIL } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.filter((c) => c.includes(EMAIL))).toHaveLength(1);
  });

  it("alert na uptime check tworzony WYŁĄCZONY (wyciszony do kroku 3), z kanałem e-mail", () => {
    const r = lb(APPLY);
    const p = r.calls.map(strip).filter((c) => /^alpha monitoring policies create /.test(c));
    expect(p).toHaveLength(1);
    expect(r.files).toMatch(/"enabled": false/);
    expect(r.files).toContain("monitoring.googleapis.com/uptime_check/check_passed");
    expect(r.files).toContain('resource.label.host=\\"app.nordsignal.cc\\"');
    expect(r.files).not.toContain(EMAIL);
  });

  it("błąd odczytu listy (uptime/kanał/alert) przerywa przebieg zamiast tworzyć duplikat", () => {
    const r = lb(APPLY, { listError: true });
    expect(r.status).toBe(2);
    expect(r.calls.map(strip).filter((c) => /^(monitoring uptime create|beta monitoring channels create|alpha monitoring policies create)/.test(c))).toEqual([]);
  });
});

describe("P1: idempotencja i --teardown", () => {
  it("istniejące zasoby nie są tworzone ponownie (tylko aktualizacje bez dryfu)", () => {
    const r = lb(APPLY, { exists: true });
    expect(r.status, r.stderr).toBe(0);
    const calls = r.calls.map(strip);
    expect(calls.filter((c) => / create /.test(c))).toEqual([]);
    expect(calls.filter((c) => / add-backend /.test(c))).toEqual([]);
    const upd = calls.filter((c) => / update /.test(c));
    expect(upd.some((c) => /^compute ssl-policies update myhelper-lb-tls12 .*--profile=MODERN .*--min-tls-version=1\.2/.test(c))).toBe(true);
    expect(upd.some((c) => /^compute backend-services update myhelper-lb-backend .*--enable-logging/.test(c))).toBe(true);
  });

  it("--teardown usuwa w odwrotnej kolejności i niczego nie tworzy", () => {
    const calls = lb(TEARDOWN, { exists: true }).calls.map(strip);
    expect(calls.filter((c) => / (create|import|add-backend|enable) /.test(c))).toEqual([]);
    const deletes = calls.filter((c) => / delete /.test(c));
    const order = [
      /^alpha monitoring policies delete /,
      /^beta monitoring channels delete /,
      /^monitoring uptime delete /,
      /^compute forwarding-rules delete myhelper-lb-http-fr /,
      /^compute target-http-proxies delete myhelper-lb-http-proxy /,
      /^compute url-maps delete myhelper-lb-http-redirect /,
      /^compute forwarding-rules delete myhelper-lb-https-fr /,
      /^compute target-https-proxies delete myhelper-lb-https-proxy /,
      /^compute ssl-policies delete myhelper-lb-tls12 /,
      /^certificate-manager certificates delete myhelper-lb-cert /,
      /^certificate-manager dns-authorizations delete myhelper-lb-dnsauth /,
      /^compute url-maps delete myhelper-lb-https /,
      /^compute backend-services delete myhelper-lb-backend /,
      /^compute network-endpoint-groups delete myhelper-lb-neg /,
      /^compute addresses delete myhelper-lb-ip /,
      /^compute networks subnets delete myhelper-lb-proxy-only /,
      /^compute networks delete myhelper-lb-vpc/,
    ];
    expect(deletes).toHaveLength(order.length);
    order.forEach((re, i) => expect(deletes[i], String(re)).toMatch(re));
  });

  it("--teardown nie usuwa niczego, czego nie ma", () => {
    const calls = lb(TEARDOWN).calls.map(strip);
    expect(calls.filter((c) => MUTATING.test(c))).toEqual([]);
  });

  it("--teardown nie wymaga adresu powiadomień", () => {
    expect(lb(TEARDOWN).status).toBe(0);
  });
});

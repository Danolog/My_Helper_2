// @vitest-environment node
/**
 * Strażnik konfiguracji monitoringu: infra/gcp/monitoring.sh.
 * Skrypt jest uruchamiany z podstawionym `gcloud` (zapisuje argumenty i treść
 * plików --policy-from-file), więc testy sprawdzają ZACHOWANIE:
 *  - domyślnie dry-run: zero wywołań gcloud, także odczytów (tworzenie i --undo);
 *  - każde wywołanie idzie z --project i --quiet; jedyne wywołanie w kodzie to tablica GC;
 *  - kanał powiadomień wyłącznie z lb.sh (wyszukiwany po displayName); skrypt
 *    nie tworzy ani nie usuwa kanału; brak kanału przy --apply = kod 2 przed zmianą;
 *  - adres run.app z odczytu usługi (nie na sztywno), sprawdzany wzorcem;
 *  - dokładne filtry alertów (błędy bez logu żądań Cloud Run), próg 5xx (> 3 w 300 s, liczba), limit powiadomień
 *    10 min i autoClose na alertach z logów, brak labelExtractors;
 *  - uptime check run.app: https, /api/health, timeout ≥ 10 s, ≥ 3 regiony,
 *    dopasowanie treści zgodne z odpowiedzią /api/health;
 *  - idempotencja: istniejące zasoby nie są tworzone ponownie;
 *  - --undo usuwa tylko zasoby skryptu; --only-runapp tylko uptime run.app i jego alert;
 *  - brak adresu e-mail w pliku.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/monitoring.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
/** Kod bez linii komentarza (komentarze nazywają zakazy, np. labelExtractors). */
const CODE = SOURCE.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const PROJECT = "my-helper-2-488419";
const REGION = "europe-central2";
const RUN_URL = "https://myhelper-843777043748.europe-central2.run.app";
const RUN_HOST = "myhelper-843777043748.europe-central2.run.app";
const CHANNEL_ID = "projects/p/notificationChannels/111";

const ERRORS_FILTER =
  'resource.type="cloud_run_revision" AND resource.labels.service_name="myhelper" AND severity>=ERROR AND NOT log_id("run.googleapis.com/requests")';
const SCHEDULER_FILTER = 'resource.type="cloud_scheduler_job" AND severity>=ERROR';
const HTTP5XX_FILTER =
  'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.label.service_name="myhelper" AND metric.label.response_code_class="5xx"';
const UPTIME_FILTER = `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND resource.label.host="${RUN_HOST}"`;
const NAMES = {
  errors: "myhelper-run-errors-alert",
  http5xx: "myhelper-run-5xx-alert",
  scheduler: "myhelper-scheduler-errors-alert",
  uptime: "myhelper-runapp-health",
  uptimeAlert: "myhelper-runapp-health-alert",
  channel: "myhelper-lb-owner-email",
};

const DIR = mkdtempSync(join(tmpdir(), "monitoring-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const FAKE = join(DIR, "bin");
mkdirSync(FAKE, { recursive: true });
writeFileSync(
  join(FAKE, "gcloud"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
for a in "$@"; do
  case "$a" in
    --policy-from-file=*) cat "\${a#*=}" >> "$FAKE_FILES"; printf '\\n---\\n' >> "$FAKE_FILES" ;;
  esac
done
case " $* " in
  *" policies create "*)
    [ -n "$FAKE_CREATE_ERROR" ] && { echo "ERROR: INVALID_ARGUMENT" >&2; exit 1; }
    exit 0 ;;
  *" channels list "*)
    [ -n "$FAKE_LIST_ERROR" ] && { echo "ERROR: PERMISSION_DENIED" >&2; exit 1; }
    [ -n "$FAKE_NO_CHANNEL" ] || echo "${CHANNEL_ID}"
    exit 0 ;;
  *" run services describe "*)
    [ -n "$FAKE_URL_ERROR" ] && { echo "ERROR: NOT_FOUND" >&2; exit 1; }
    printf '%s\\n' "\${FAKE_RUN_URL-${RUN_URL}}"
    exit 0 ;;
  *" list "*|*" list-configs "*)
    [ -n "$FAKE_LIST_ERROR" ] && { echo "ERROR: PERMISSION_DENIED" >&2; exit 1; }
    [ -n "$FAKE_EXISTS" ] && echo "projects/p/x/fake-1"
    exit 0 ;;
esac
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
  /** Pliki pozostawione przez skrypt w jego TMPDIR po przebiegu. */
  leftovers: string[];
}

let n = 0;
function mon(
  args: string[],
  opts: {
    exists?: boolean;
    noChannel?: boolean;
    listError?: boolean;
    urlError?: boolean;
    createError?: boolean;
    runUrl?: string;
  } = {},
): Run {
  const id = n++;
  const log = join(DIR, `log-${id}`);
  const files = join(DIR, `files-${id}`);
  // Osobny TMPDIR na przebieg: pozwala sprawdzić, że mktemp nic nie zostawia.
  const tmp = join(DIR, `tmp-${id}`);
  mkdirSync(tmp);
  for (const f of [log, files]) writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: `${FAKE}:${process.env.PATH}`,
      TMPDIR: tmp,
      FAKE_LOG: log,
      FAKE_FILES: files,
      ...(opts.exists ? { FAKE_EXISTS: "1" } : {}),
      ...(opts.noChannel ? { FAKE_NO_CHANNEL: "1" } : {}),
      ...(opts.listError ? { FAKE_LIST_ERROR: "1" } : {}),
      ...(opts.urlError ? { FAKE_URL_ERROR: "1" } : {}),
      ...(opts.createError ? { FAKE_CREATE_ERROR: "1" } : {}),
      ...(opts.runUrl !== undefined ? { FAKE_RUN_URL: opts.runUrl } : {}),
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
    files: readFileSync(files, "utf8"),
    leftovers: readdirSync(tmp),
  };
}

const P = [`--project=${PROJECT}`];
const APPLY = [...P, "--apply"];
const strip = (c: string) => c.replace(`--project=${PROJECT} --quiet `, "");
const MUTATING = / (create|update|delete|enable) /;
const mutating = (r: Run) => r.calls.map(strip).filter((c) => MUTATING.test(` ${c} `));

type Policy = {
  displayName: string;
  enabled: boolean;
  documentation?: { content: string };
  conditions: Array<{
    conditionMatchedLog?: { filter: string; labelExtractors?: Record<string, string> };
    conditionThreshold?: {
      filter: string;
      aggregations: Array<Record<string, unknown>>;
      comparison: string;
      thresholdValue: number;
      duration: string;
    };
  }>;
  alertStrategy?: { notificationRateLimit?: { period: string }; autoClose?: string };
  notificationChannels: string[];
};

/** Pliki polityk z --policy-from-file (JSON między separatorami), po nazwie. */
function policies(files: string): Record<string, Policy> {
  const out: Record<string, Policy> = {};
  for (const b of files.split("\n---\n").filter((x) => x.trim().startsWith("{"))) {
    const p = JSON.parse(b) as Policy;
    out[p.displayName] = p;
  }
  return out;
}

const seconds = (d: string) => Number(/^(\d+)s$/.exec(d)?.[1] ?? NaN);

describe("monitoring: dry-run i parametry", () => {
  it.each([
    ["bez flag", P],
    ["--project ze spacją", ["--project", PROJECT]],
    ["jawny region", [...P, `--region=${REGION}`]],
    ["--undo", [...P, "--undo"]],
    ["--undo --only-runapp", [...P, "--undo", "--only-runapp"]],
  ])("%s: domyślnie dry-run — zero wywołań gcloud, także odczytów", (_l, args) => {
    const r = mon(args);
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^mode: DRY-RUN/);
    expect(r.stdout).toMatch(/\nmonitoring (create|undo): done\n$/);
  });

  it("jawne --dry-run po --apply wygrywa i nic nie wykonuje", () => {
    expect(mon([...APPLY, "--dry-run"]).calls).toEqual([]);
  });

  it("wyjście dry-run to wyłącznie polecenia, odczyty stanu i opis zmiany", () => {
    for (const line of mon(P).stdout.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^(mode: |\? gcloud |\+ gcloud |  state: |  policy: |  skip: |  run\.app host: |monitoring create: done$)/);
    }
  });

  it("dry-run: odczyt kanału i adresu usługi przed zmianami, potem (1)–(4) w kolejności", () => {
    const lines = mon(P).stdout.split("\n");
    const cmds = lines.filter((l) => l.startsWith("? gcloud ") || l.startsWith("+ gcloud ")).map((l) => l.slice(2));
    expect(cmds[0]).toBe(
      `gcloud --project=${PROJECT} --quiet beta monitoring channels list --filter=displayName="${NAMES.channel}" --format=value(name)`,
    );
    expect(cmds[1]).toBe(`gcloud --project=${PROJECT} --quiet run services describe myhelper --region=${REGION} --format=value(status.url)`);
    const plus = lines.filter((l) => l.startsWith("+ gcloud ")).map((l) => strip(l.slice(2 + "gcloud ".length)));
    expect(plus.map((c) => c.split(" ").slice(0, 4).join(" "))).toEqual([
      "alpha monitoring policies create",
      "alpha monitoring policies create",
      "alpha monitoring policies create",
      `monitoring uptime create ${NAMES.uptime}`,
      "alpha monitoring policies create",
    ]);
    const order = lines
      .filter((l) => l.startsWith("  policy: "))
      .map((l) => /"displayName": "([^"]+)"/.exec(l)?.[1]);
    expect(order).toEqual([NAMES.errors, NAMES.http5xx, NAMES.scheduler, NAMES.uptimeAlert]);
  });

  it.each([
    ["bez --project", ["--apply"]],
    ["nieprawidłowy projekt", ["--project=Bad_Project", "--apply"]],
    ["region spoza allowlisty", [...APPLY, "--region=europe-west1"]],
    ["nieznany argument", [...APPLY, "--force"]],
    ["--notify-email (kanał tylko z lb.sh)", [...APPLY, "--notify-email=x"]],
    ["--only-runapp bez --undo", [...APPLY, "--only-runapp"]],
  ])("%s → kod 2 przed pierwszym gcloud", (_l, args) => {
    const r = mon(args);
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

describe("monitoring: kod skryptu", () => {
  it("w kodzie jedyne wywołanie gcloud to tablica GC (reszta to echo)", () => {
    const lines = SOURCE.split("\n").filter((l) => /\bgcloud\b/.test(l) && !l.trim().startsWith("#"));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$|^\s*echo "[+?] gcloud /);
  });

  it("stałe nazwy zasobów i kanał z lb.sh (ta sama nazwa co CHANNEL w lb.sh)", () => {
    expect(SOURCE).toContain(`CHANNEL="${NAMES.channel}"\n`);
    expect(readFileSync(join(ROOT, "infra/gcp/lb.sh"), "utf8")).toContain(`CHANNEL="${NAMES.channel}"\n`);
    expect(SOURCE).toContain(`ERRORS_ALERT="${NAMES.errors}"\n`);
    expect(SOURCE).toContain(`HTTP5XX_ALERT="${NAMES.http5xx}"\n`);
    expect(SOURCE).toContain(`SCHEDULER_ALERT="${NAMES.scheduler}"\n`);
    expect(SOURCE).toContain(`RUNAPP_UPTIME="${NAMES.uptime}"\n`);
    expect(SOURCE).toContain(`RUNAPP_ALERT="${NAMES.uptimeAlert}"\n`);
  });

  it("dokładne filtry w kodzie", () => {
    expect(SOURCE).toContain(`ERRORS_FILTER='${ERRORS_FILTER}'\n`);
    expect(SOURCE).toContain(`SCHEDULER_FILTER='${SCHEDULER_FILTER}'\n`);
    expect(SOURCE).toContain(`HTTP5XX_FILTER='${HTTP5XX_FILTER}'\n`);
  });

  it("filtr błędów wyklucza log żądań Cloud Run (5xx pilnuje alert metryki)", () => {
    const p = policies(mon(APPLY).files)[NAMES.errors]!;
    const filter = p.conditions[0]!.conditionMatchedLog!.filter;
    expect(filter).toMatch(/ AND NOT log_id\("run\.googleapis\.com\/requests"\)$/);
    expect(filter).toContain("severity>=ERROR");
  });

  it("bez tworzenia i usuwania kanału, bez labelExtractors, bez wiązań IAM", () => {
    expect(CODE).not.toMatch(/channels (create|delete|update)/);
    expect(CODE).not.toMatch(/labelExtractors/);
    expect(CODE).not.toMatch(/--notify-email|NOTIFY_EMAIL|email_address/);
    expect(CODE).not.toMatch(/add-iam-policy-binding|set-iam-policy|\b(curl|wget|vercel|gsutil)\b/);
  });

  it("adres run.app nie jest wpisany na sztywno (odczyt status.url)", () => {
    expect(SOURCE).not.toContain("843777043748");
    expect(CODE).toContain('lookup run services describe "$SERVICE" "--region=${REGION}" "--format=value(status.url)"');
  });

  it("w pliku brak adresów e-mail", () => {
    expect(SOURCE).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });

  it("region: jedyny region GCP w pliku to europe-central2", () => {
    expect(SOURCE.match(/\b(europe|us|asia|me|africa|northamerica|southamerica|australia)-[a-z]+\d\b/g)?.every((x) => x === REGION)).toBe(true);
  });
});

describe("monitoring --apply: zasoby", () => {
  it("każde wywołanie przez GC (--project, --quiet)", () => {
    for (const o of [{}, { exists: true }]) {
      const r = mon(APPLY, o);
      expect(r.status, r.stderr).toBe(0);
      expect(r.calls.length).toBeGreaterThan(0);
      for (const c of r.calls) expect(c.startsWith(`--project=${PROJECT} --quiet `), c).toBe(true);
    }
  });

  it("stan pusty → 4 polityki i 1 uptime check; odczyty kanału i adresu przed pierwszą zmianą", () => {
    const r = mon(APPLY);
    expect(r.status, r.stderr).toBe(0);
    const calls = r.calls.map(strip);
    expect(calls[0]).toBe(`beta monitoring channels list --filter=displayName="${NAMES.channel}" --format=value(name)`);
    expect(calls[1]).toBe(`run services describe myhelper --region=${REGION} --format=value(status.url)`);
    const m = mutating(r);
    expect(m.filter((c) => c.startsWith("alpha monitoring policies create "))).toHaveLength(4);
    expect(m.filter((c) => c.startsWith("monitoring uptime create "))).toHaveLength(1);
    expect(m).toHaveLength(5);
    expect(Object.keys(policies(r.files)).sort()).toEqual(
      [NAMES.errors, NAMES.http5xx, NAMES.scheduler, NAMES.uptimeAlert].sort(),
    );
  });

  it("wszystkie polityki: włączone, wyłącznie kanał z lb.sh", () => {
    for (const p of Object.values(policies(mon(APPLY).files))) {
      expect(p.enabled, p.displayName).toBe(true);
      expect(p.notificationChannels, p.displayName).toEqual([CHANNEL_ID]);
      // Error Reporting jest wyłączony (lokalizacja „global”), opis nie może do niego odsyłać.
      expect(p.documentation?.content ?? "", p.displayName).not.toMatch(/Error Reporting/);
    }
  });

  it.each([
    [NAMES.errors, ERRORS_FILTER],
    [NAMES.scheduler, SCHEDULER_FILTER],
  ])("%s: alert na logach z dokładnym filtrem, limit 5–15 min, autoClose, bez labelExtractors", (name, filter) => {
    const p = policies(mon(APPLY).files)[name]!;
    expect(p.conditions).toHaveLength(1);
    const c = p.conditions[0]!;
    expect(c.conditionMatchedLog).toEqual({ filter });
    expect(c.conditionMatchedLog?.labelExtractors).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/labelExtractors|message|stack_trace|jsonPayload|textPayload/);
    const period = seconds(p.alertStrategy!.notificationRateLimit!.period);
    expect(period).toBe(600);
    expect(period).toBeGreaterThanOrEqual(300);
    expect(period).toBeLessThanOrEqual(900);
    expect(seconds(p.alertStrategy!.autoClose!)).toBe(1800);
  });

  it("5xx: liczba > 3 w oknie 300 s (suma, nie procent), dokładny filtr", () => {
    const p = policies(mon(APPLY).files)[NAMES.http5xx]!;
    expect(p.conditions).toHaveLength(1);
    const t = p.conditions[0]!.conditionThreshold!;
    expect(t.filter).toBe(HTTP5XX_FILTER);
    expect(t.comparison).toBe("COMPARISON_GT");
    expect(t.thresholdValue).toBe(3);
    expect(t.aggregations).toEqual([{ alignmentPeriod: "300s", perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }]);
    expect(JSON.stringify(p)).not.toMatch(/RATIO|denominator|ALIGN_RATE|ALIGN_FRACTION/);
  });

  it("uptime check run.app: host z odczytu usługi, https, /api/health, timeout ≥ 10 s, ≥ 3 regiony, dopasowanie treści", () => {
    const c = mutating(mon(APPLY)).filter((x) => x.startsWith("monitoring uptime create "));
    expect(c).toEqual([
      `monitoring uptime create ${NAMES.uptime} --resource-type=uptime-url --resource-labels=host=${RUN_HOST},project_id=${PROJECT} ` +
        `--protocol=https --port=443 --path=/api/health --period=1 --timeout=10 --regions=europe,usa-oregon,asia-pacific ` +
        `--validate-ssl=true --matcher-type=contains-string --matcher-content="status":"healthy"`,
    ]);
    const timeout = Number(/--timeout=(\d+)/.exec(c[0]!)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(10);
    const regions = /--regions=([^ ]+)/.exec(c[0]!)![1]!.split(",");
    expect(new Set(regions).size).toBeGreaterThanOrEqual(3);
  });

  it("dopasowanie treści pasuje do odpowiedzi zdrowej /api/health, nie do niezdrowej", () => {
    const route = readFileSync(join(ROOT, "src/app/api/health/route.ts"), "utf8");
    expect(route).toContain("status: 'healthy'");
    expect(route).toContain("status: 'unhealthy'");
    expect(route).toContain("NextResponse.json(");
    const match = '"status":"healthy"';
    expect(SOURCE).toContain(`HEALTH_MATCH='${match}'\n`);
    expect(JSON.stringify({ status: "healthy", timestamp: "t" })).toContain(match);
    expect(JSON.stringify({ status: "unhealthy", timestamp: "t" })).not.toContain(match);
  });

  it("alert uptime: check_passed na hoście run.app, opis wspomina awarię bazy", () => {
    const p = policies(mon(APPLY).files)[NAMES.uptimeAlert]!;
    const t = p.conditions[0]!.conditionThreshold!;
    expect(t.filter).toBe(UPTIME_FILTER);
    expect(t.aggregations[0]).toMatchObject({ perSeriesAligner: "ALIGN_NEXT_OLDER", crossSeriesReducer: "REDUCE_COUNT_FALSE" });
    expect(p.documentation?.content).toMatch(/baz/);
  });

  it("zasoby istnieją → brak create, wypisany skip", () => {
    const r = mon(APPLY, { exists: true });
    expect(r.status, r.stderr).toBe(0);
    expect(mutating(r)).toEqual([]);
    for (const name of [NAMES.errors, NAMES.http5xx, NAMES.scheduler, NAMES.uptime, NAMES.uptimeAlert]) {
      expect(r.stdout).toContain(`  skip: ${name} exists\n`);
    }
  });

  it("wyjście nie zawiera e-maila ani treści kanału poza jego identyfikatorem", () => {
    const r = mon(APPLY);
    expect(r.stdout + r.stderr).not.toMatch(/@/);
  });
});

describe("monitoring --apply: błędy (stop przed zmianą)", () => {
  it("brak kanału z lb.sh → kod 2, komunikat o lb.sh, zero zmian, bez tworzenia kanału", () => {
    const r = mon(APPLY, { noChannel: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`notification channel ${NAMES.channel} missing — run infra/gcp/lb.sh --apply first`);
    expect(mutating(r)).toEqual([]);
    expect(r.calls.map(strip).filter((c) => / channels /.test(` ${c} `) && !/ channels list /.test(` ${c} `))).toEqual([]);
  });

  it("brak kanału w dry-run → kod 0 (stan nie jest sprawdzany)", () => {
    const r = mon(P, { noChannel: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it.each([
    ["błąd odczytu kanału", { listError: true }, "cannot read"],
    ["błąd odczytu usługi", { urlError: true }, "cannot read"],
    ["pusty adres usługi", { runUrl: "" }, "has no URL"],
    ["obcy host", { runUrl: "https://evil.example.com" }, "unexpected URL"],
    ["http zamiast https", { runUrl: "http://myhelper-843777043748.europe-central2.run.app" }, "unexpected URL"],
    ["inna usługa", { runUrl: "https://other-843777043748.europe-central2.run.app" }, "unexpected URL"],
    ["adres ze ścieżką", { runUrl: `${RUN_URL}/x` }, "unexpected URL"],
    ["host podszywający się pod run.app", { runUrl: "https://myhelper-1.run.app.evil.example" }, "unexpected URL"],
  ])("%s → kod 2, zero zmian", (_l, o, msg) => {
    const r = mon(APPLY, o);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(msg);
    expect(mutating(r)).toEqual([]);
  });

  it("pliki tymczasowe polityk usunięte po udanym --apply i w dry-run", () => {
    for (const args of [APPLY, P]) {
      const r = mon(args);
      expect(r.status, r.stderr).toBe(0);
      expect(r.leftovers, args.join(" ")).toEqual([]);
    }
  });

  it("błąd policies create → przebieg przerwany, plik tymczasowy usunięty", () => {
    const r = mon(APPLY, { createError: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("INVALID_ARGUMENT");
    // Przerwanie na pierwszej polityce: dalszych zmian brak.
    expect(mutating(r)).toHaveLength(1);
    expect(r.stdout).not.toContain("monitoring create: done");
    expect(r.leftovers).toEqual([]);
  });

  it("adres w starym formacie run.app (z hashem) jest przyjęty", () => {
    const r = mon(APPLY, { runUrl: "https://myhelper-abc123xyz-lm.a.run.app" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("  run.app host: myhelper-abc123xyz-lm.a.run.app\n");
  });
});

describe("monitoring --undo", () => {
  it("dry-run: lista usunięć 4 polityk i uptime checku, bez kanału", () => {
    const r = mon([...P, "--undo"]);
    const plus = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("+ gcloud "))
      .map((l) => strip(l.slice(2 + "gcloud ".length)));
    expect(plus).toEqual([
      "alpha monitoring policies delete <name-from-list>",
      "monitoring uptime delete <name-from-list>",
      "alpha monitoring policies delete <name-from-list>",
      "alpha monitoring policies delete <name-from-list>",
      "alpha monitoring policies delete <name-from-list>",
    ]);
    expect(r.stdout).toContain(`  skip: channel ${NAMES.channel} kept (owned by lb.sh)\n`);
  });

  it("--apply przy istniejących zasobach: usuwa 5 zasobów skryptu, kanału nie dotyka", () => {
    const r = mon([...APPLY, "--undo"], { exists: true });
    expect(r.status, r.stderr).toBe(0);
    const m = mutating(r);
    expect(m).toHaveLength(5);
    expect(m.every((c) => / delete /.test(` ${c} `))).toBe(true);
    expect(r.calls.map(strip).filter((c) => / channels /.test(` ${c} `))).toEqual([]);
    const lists = r.calls.map(strip).filter((c) => / list /.test(` ${c} `) || / list-configs /.test(` ${c} `));
    expect(lists.map((c) => /displayName="([^"]+)"/.exec(c)?.[1])).toEqual([
      NAMES.uptimeAlert,
      NAMES.uptime,
      NAMES.scheduler,
      NAMES.http5xx,
      NAMES.errors,
    ]);
  });

  it("--apply bez zasobów: zero usunięć", () => {
    const r = mon([...APPLY, "--undo"]);
    expect(r.status, r.stderr).toBe(0);
    expect(mutating(r)).toEqual([]);
  });

  it("--undo --only-runapp: wyłącznie alert uptime run.app i uptime check", () => {
    const r = mon([...APPLY, "--undo", "--only-runapp"], { exists: true });
    expect(r.status, r.stderr).toBe(0);
    expect(mutating(r)).toEqual(["alpha monitoring policies delete projects/p/x/fake-1", "monitoring uptime delete projects/p/x/fake-1"]);
    const names = r.calls.map(strip).map((c) => /displayName="([^"]+)"/.exec(c)?.[1]).filter(Boolean);
    expect(names).toEqual([NAMES.uptimeAlert, NAMES.uptime]);
    expect(r.stdout).toMatch(/^mode: APPLY .*scope=runapp\)/);
  });

  it("błąd odczytu przy --undo → kod 2, zero usunięć", () => {
    const r = mon([...APPLY, "--undo"], { exists: true, listError: true });
    expect(r.status).toBe(2);
    expect(mutating(r)).toEqual([]);
  });
});

// @vitest-environment node
/**
 * Strażnik G-C5b (krok D, K-3; #121 j): `infra/gcp/scheduler.sh` z podstawionym
 * `gcloud` (stan zadań w plikach), więc sprawdzamy zachowanie, nie tekst:
 *  - nowe zadanie: create z harmonogramem zaparkowanym (29 lutego) → pause →
 *    odczyt stanu = PAUSED → dopiero wtedy właściwy harmonogram;
 *  - tryb domyślny nigdy nie wznawia; po nim wszystko jest PAUSED;
 *  - pauza, która nie zadziałała → stop z kodem 1, kolejne zadania nie powstają;
 *  - --resume tylko z jawnymi nazwami zadań ENABLED z tabeli (W-3), wymaga
 *    istnienia zadań; nazwa nieznana albo PAUSED → kod 2 przed gcloud;
 *  - --check: dryf przed --resume, zgodność po nim;
 *  - fałszywy gcloud odrzuca pause na nie-ENABLED i resume na nie-PAUSED jak
 *    API (FAILED_PRECONDITION) — ponowne przebiegi muszą to omijać (Ethan 2);
 *  - zadanie ENABLED z harmonogramem zaparkowanym = nowe (Ethan 1);
 *  - token: odczyt raz, przed pierwszą zmianą; błąd/pusty → stop (W-1);
 *    wywołania z nagłówkiem bez lokalnego logu gcloud (B-1); update niesie
 *    nagłówek (rotacja); token nigdy w argumentach ani na wyjściu;
 *  - BASE_URL wyłącznie główny adres usługi (#143 pkt 1);
 *  - bez zadań mh-notify-* (Oliver, do R3-C).
 * Mutacje: wynik w opisie PR.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/gcp/scheduler.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");
const TABLE = [...SOURCE.match(/^JOBS=\(\n([\s\S]*?)^\)/m)![1]!.matchAll(/^\s*"([^"|]+)\|([^|]+)\|([^|]+)\|(ENABLED|PAUSED)"$/gm)].map(
  (m) => ({ name: m[1]!, path: m[2]!, schedule: m[3]!, state: m[4]! }),
);
const TOKEN = "fake-cron-token-do-not-leak";
const SERVICE_URL = "https://myhelper-843777043748.europe-central2.run.app";
const NAMES = TABLE.filter((j) => j.state === "ENABLED").map((j) => j.name);

const DIR = mkdtempSync(join(tmpdir(), "g-c5b-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const BIN = join(DIR, "bin");
mkdirSync(BIN);
// Fałszywy gcloud: stan zadania w $FAKE_JOBS/<nazwa>.json, każde wywołanie w $FAKE_LOG.
writeFileSync(
  join(BIN, "gcloud"),
  `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const a = process.argv.slice(2);
const flag = (k) => { const f = a.find((x) => x.startsWith("--" + k + "=")); return f && f.slice(k.length + 3); };
const ffPath = flag("flags-file");
const ffText = ffPath ? fs.readFileSync(ffPath, "utf8") : null;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ a, env: process.env.CLOUDSDK_CORE_DISABLE_FILE_LOGGING ?? null, ff: ffText }) + "\\n");
const pos = a.filter((x) => !x.startsWith("--"));
if (pos[0] === "secrets") {
  if (process.env.FAKE_SECRET_FAIL) { process.stderr.write("ERROR: PERMISSION_DENIED\\n"); process.exit(1); }
  process.stdout.write(process.env.FAKE_TOKEN); process.exit(0);
}
const verb = pos[2], name = verb === "create" || verb === "update" ? pos[4] : pos[3];
const file = path.join(process.env.FAKE_JOBS, name + ".json");
// Odrzucenie serii zmian (pomiar Olivera): pierwsze FAKE_ABORTED_TIMES wywołań
// czasownika FAKE_ABORTED_VERB → ABORTED. Na stderr także treść pliku flag —
// najgorszy przypadek: skrypt nie może jej przepuścić na wyjście.
const counter = path.join(process.env.FAKE_JOBS, ".aborted");
if (process.env.FAKE_ABORTED_VERB === verb) {
  const k = Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : "0");
  const max = process.env.FAKE_ABORTED_TIMES === "inf" ? Infinity : Number(process.env.FAKE_ABORTED_TIMES || 0);
  if (k < max) {
    fs.writeFileSync(counter, String(k + 1));
    process.stderr.write("ERROR: (gcloud.scheduler.jobs." + verb + ") ABORTED: sync mutate calls cannot be queued\\n" + (ffText || ""));
    process.exit(1);
  }
}
if (process.env.FAKE_FAIL_VERB === verb) { process.stderr.write("ERROR: PERMISSION_DENIED\\n" + (ffText || "")); process.exit(1); }
// D-8: gcloud cytuje samą wartość (bez słów Authorization/Bearer) w komunikacie błędu.
if (process.env.FAKE_ECHO_TOKEN_VERB === verb && ffText) {
  const tok = (ffText.match(/Bearer ([^"]*)"/) || [])[1] || "";
  // Druga linia: nagłówek ze skróconą wartością — filtr tokenu jej nie złapie, filtr nagłówka tak.
  process.stderr.write("ERROR: INVALID_ARGUMENT: header value [" + tok + "] rejected\\n  Authorization: \\"Bearer " + tok.slice(0, 8) + "...\\"\\nhint: check the job definition\\n");
  process.exit(1);
}
const job = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
const save = (j) => fs.writeFileSync(file, JSON.stringify(j));
// Jak prawdziwy gcloud: create/update http bez --format=none wypisują zasób zadania
// (z nagłówkami) na stdout.
const headersOf = (t) => Object.fromEntries([...(t || "").matchAll(/^  ([A-Za-z-]+): "(.*)"$/gm)].map((m) => [m[1], m[2]]));
const printResource = (j) => { if (flag("format") !== "none") console.log(JSON.stringify({ name, schedule: j.schedule, state: j.state, httpTarget: { uri: j.uri, headers: j.headers || {} } })); };
if (verb === "describe") {
  if (!job) process.exit(1);
  const fmt = flag("format");
  if (fmt === "value(name)") console.log(name);
  else if (fmt === "value(state)") console.log(job.state);
  else if (fmt === "value(schedule)") {
    if (process.env.FAKE_SCHEDULE_READ === "fail") { process.stderr.write("ERROR: UNAVAILABLE\\n"); process.exit(1); }
    console.log(process.env.FAKE_SCHEDULE_READ === "empty" ? "" : job.schedule);
  }
  else console.log([job.schedule, job.timeZone, job.uri, job.method, job.state].join("\\t"));
} else if (verb === "create") {
  if (job) process.exit(1);
  if (!ffText || !ffText.includes("Authorization")) process.exit(3);
  if (!flag("schedule")) process.exit(4);
  const created = { schedule: flag("schedule"), timeZone: flag("time-zone"), uri: flag("uri"), method: flag("http-method"), state: "ENABLED", headers: headersOf(ffText) };
  save(created);
  printResource(created);
} else if (verb === "update") {
  if (!job) process.exit(1);
  for (const [k, f] of [["schedule", "schedule"], ["timeZone", "time-zone"], ["uri", "uri"], ["method", "http-method"]]) if (flag(f)) job[k] = flag(f);
  if (ffText) job.headers = { ...(job.headers || {}), ...headersOf(ffText) };
  save(job);
  printResource(job);
} else if (verb === "pause") {
  if (!job) process.exit(1);
  if (job.state !== "ENABLED") { process.stderr.write("ERROR: FAILED_PRECONDITION: job is not ENABLED\\n"); process.exit(1); }
  if (!process.env.FAKE_PAUSE_NOOP) job.state = "PAUSED";
  save(job);
} else if (verb === "resume") {
  if (!job) process.exit(1);
  if (job.state !== "PAUSED") { process.stderr.write("ERROR: FAILED_PRECONDITION: job is not PAUSED\\n"); process.exit(1); }
  job.state = "ENABLED"; save(job);
} else process.exit(9);
`,
);
chmodSync(join(BIN, "gcloud"), 0o755);
// Fałszywy sleep: zapisuje odstęp, nie czeka (odstępy ponawiania bez minut czekania).
writeFileSync(join(BIN, "sleep"), '#!/bin/sh\n[ -n "$FAKE_SLEEP_LOG" ] && echo "$1" >> "$FAKE_SLEEP_LOG"\nexit 0\n');
chmodSync(join(BIN, "sleep"), 0o755);

let n = 0;
function world() {
  const jobs = join(DIR, `jobs-${n++}`);
  mkdirSync(jobs);
  const log = join(DIR, `log-${n++}`);
  writeFileSync(log, "");
  const sleepLog = join(DIR, `sleep-${n++}`);
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${BIN}:${process.env.PATH}`,
        PROJECT_ID: "my-helper-2-488419",
        REGION: "europe-central2",
        BASE_URL: SERVICE_URL,
        FAKE_JOBS: jobs,
        FAKE_LOG: log,
        FAKE_TOKEN: TOKEN,
        FAKE_SLEEP_LOG: sleepLog,
        ...extra,
      },
    });
    return { ...r, log: readFileSync(log, "utf8") };
  };
  const entries = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { a: string[]; env: string | null; ff: string | null });
  const calls = () => entries().map((e) => e.a);
  const state = (name: string) => JSON.parse(readFileSync(join(jobs, `${name}.json`), "utf8")) as Record<string, string>;
  const count = () => readdirSync(jobs).filter((f) => !f.startsWith(".")).length;
  const seed = (name: string, j: Record<string, string>) => writeFileSync(join(jobs, `${name}.json`), JSON.stringify(j));
  const sleeps = () => (existsSync(sleepLog) ? readFileSync(sleepLog, "utf8").split("\n").filter(Boolean).map(Number) : []);
  return { run, calls, entries, state, count, seed, jobs, sleeps };
}

const verbOf = (c: string[]) => c.filter((x) => !x.startsWith("--")).slice(2, 4).join(" ");
const nameOf = (c: string[]) => {
  const p = c.filter((x) => !x.startsWith("--"));
  return p[2] === "create" || p[2] === "update" ? p[4] : p[3];
};

describe("G-C5b: tworzenie wstrzymane (#121 j)", () => {
  it("tabela: 5 zadań systemowych /api/cron/*, bez mh-notify-* (Oliver: do R3-C)", () => {
    expect(TABLE.map((j) => j.name).sort()).toEqual(
      ["mh-cleanup-pending-deposits", "mh-cleanup-temporary-access", "mh-push-reminders", "mh-push-reminders-24h", "mh-sms-reminders"],
    );
    expect(TABLE.every((j) => j.path.startsWith("/api/cron/"))).toBe(true);
    expect(SOURCE.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")).not.toMatch(/mh-notify-|\/api\/notifications\//);
    // Każde przyszłe zadanie z wiadomościami do klientów musi być PAUSED (W-2).
    for (const j of TABLE.filter((x) => x.path.startsWith("/api/notifications/"))) expect(j.state, j.name).toBe("PAUSED");
  });

  it("świeży projekt: create zaparkowany → pause → odczyt PAUSED → właściwy harmonogram; nic nie wznowione", () => {
    const w = world();
    const r = w.run([]);
    expect(r.status, r.stderr).toBe(0);
    const calls = w.calls();
    expect(calls.some((c) => verbOf(c).startsWith("resume"))).toBe(false);
    for (const job of TABLE) {
      const mine = calls.filter((c) => nameOf(c) === job.name && !c.includes("--format=value(name)"));
      const seq = mine.map((c) => (c.includes("--format=value(state)") ? "state" : verbOf(c).split(" ")[0]));
      expect(seq, job.name).toEqual(["create", "state", "pause", "state", "update", "state"]);
      expect(mine[0]).toContain("--schedule=0 0 29 2 *");
      expect(mine[4]).toContain(`--schedule=${job.schedule}`);
      expect(w.state(job.name)).toMatchObject({ state: "PAUSED", schedule: job.schedule, timeZone: "Europe/Warsaw", method: "GET" });
    }
  });

  it("pauza bez skutku → stop z kodem 1 po pierwszym zadaniu, następne nie powstają", () => {
    const w = world();
    const r = w.run([], { FAKE_PAUSE_NOOP: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/expected \[PAUSED\] — stop/);
    expect(w.count()).toBe(1);
    expect(w.state(TABLE[0]!.name)).toMatchObject({ schedule: "0 0 29 2 *" });
  });

  it("ponowny przebieg: bez create, bez resume, stan PAUSED zostaje", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const before = w.calls().length;
    expect(w.run([]).status).toBe(0);
    const again = w.calls().slice(before);
    expect(again.some((c) => /^(create|resume)/.test(verbOf(c)))).toBe(false);
    for (const job of TABLE) expect(w.state(job.name).state).toBe("PAUSED");
  });

  it("istniejące włączone zadanie, które w tabeli jest PAUSED → wstrzymane (kopia z dopisanym zadaniem)", () => {
    const copy = join(DIR, "scheduler-paused-row-apply.sh");
    writeFileSync(copy, SOURCE.replace(/^\)$/m, '  "mh-future|/api/cron/sms-reminders|0 6 * * *|PAUSED"\n)'));
    const w = world();
    w.seed("mh-future", { schedule: "0 6 * * *", timeZone: "Europe/Warsaw", uri: "x", method: "GET", state: "ENABLED" });
    const r = spawnSync("bash", [copy], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${BIN}:${process.env.PATH}`, PROJECT_ID: "p-123456", REGION: "europe-central2", BASE_URL: SERVICE_URL, FAKE_JOBS: w.jobs, FAKE_LOG: join(DIR, `log-${n++}`), FAKE_TOKEN: TOKEN },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(w.state("mh-future").state).toBe("PAUSED");
  });

  it("--check: dryf przed --resume; --resume wszystkich nazw; potem --check = 0", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const pre = w.run(["--check"]);
    expect(pre.status).toBe(1);
    expect(pre.stdout).toMatch(/DRIFT mh-sms-reminders/);
    const res = w.run(["--resume", ...NAMES]);
    expect(res.status, res.stderr).toBe(0);
    for (const job of TABLE) expect(w.state(job.name).state, job.name).toBe(job.state);
    const post = w.run(["--check"]);
    expect(post.status, post.stdout).toBe(0);
  });

  it("D-8: --resume (bez odczytu tokenu) — błąd gcloud widoczny na stderr (pusty TOKEN nie wycina wszystkiego)", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const r = w.run(["--resume", "mh-cleanup-temporary-access"], { FAKE_FAIL_VERB: "resume" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("PERMISSION_DENIED");
    expect(r.stderr).toContain("failed for mh-cleanup-temporary-access");
  });

  it("--resume jednej nazwy: wznowione tylko to zadanie, reszta PAUSED", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const r = w.run(["--resume", "mh-cleanup-temporary-access"]);
    expect(r.status, r.stderr).toBe(0);
    for (const job of TABLE) expect(w.state(job.name).state, job.name).toBe(job.name === "mh-cleanup-temporary-access" ? "ENABLED" : "PAUSED");
  });

  it.each([
    ["bez nazw", ["--resume"]],
    ["nazwa nieznana", ["--resume", "mh-sms-reminder"]],
    ["nazwa poprawna + nieznana", ["--resume", "mh-sms-reminders", "mh-notify-birthday"]],
    ["opcja zamiast nazwy", ["--resume", "--all"]],
    ["zadanie zamrożonego modułu push", ["--resume", "mh-push-reminders"]],
    ["poprawna + zamrożona push-24h", ["--resume", "mh-sms-reminders", "mh-push-reminders-24h"]],
  ])("--resume %s → kod 2 przed gcloud, nic nie wznowione", (_l, args) => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const before = w.calls().length;
    const r = w.run(args);
    expect(r.status).toBe(2);
    expect(w.calls().slice(before)).toEqual([]);
    for (const job of TABLE) expect(w.state(job.name).state).toBe("PAUSED");
  });

  it("--resume nazwy, która w tabeli jest PAUSED → kod 2 przed gcloud (kopia z dopisanym zadaniem)", () => {
    const copy = join(DIR, "scheduler-paused-row.sh");
    writeFileSync(copy, SOURCE.replace(/^\)$/m, '  "mh-future|/api/cron/sms-reminders|0 6 * * *|PAUSED"\n)'));
    const w = world();
    const r = spawnSync("bash", [copy, "--resume", "mh-future"], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${BIN}:${process.env.PATH}`, PROJECT_ID: "p-123456", REGION: "europe-central2", BASE_URL: SERVICE_URL, FAKE_JOBS: w.jobs, FAKE_LOG: join(DIR, `log-${n++}`), FAKE_TOKEN: TOKEN },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/PAUSED in the table/);
  });

  it("ponowne --resume: bez wywołania resume na ENABLED (API by odrzuciło), kod 0", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    expect(w.run(["--resume", ...NAMES]).status).toBe(0);
    const before = w.calls().length;
    const again = w.run(["--resume", ...NAMES]);
    expect(again.status, again.stderr).toBe(0);
    expect(w.calls().slice(before).some((c) => verbOf(c).startsWith("resume"))).toBe(false);
  });

  it("ponowny przebieg po --resume: zadania ENABLED zostają ENABLED, bez pause", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    expect(w.run(["--resume", ...NAMES]).status).toBe(0);
    const before = w.calls().length;
    const r = w.run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(w.calls().slice(before).some((c) => verbOf(c).startsWith("pause"))).toBe(false);
    for (const job of TABLE) expect(w.state(job.name).state, job.name).toBe(job.state);
  });

  it("zadania push wznowione wcześniej (ENABLED) → przebieg domyślny je wstrzymuje, reszta bez zmian", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    expect(w.run(["--resume", ...NAMES]).status).toBe(0);
    const push = TABLE.filter((j) => j.name.startsWith("mh-push-reminders"));
    expect(push.map((j) => j.state)).toEqual(["PAUSED", "PAUSED"]);
    for (const job of push) {
      w.seed(job.name, { schedule: job.schedule, timeZone: "Europe/Warsaw", uri: SERVICE_URL + job.path, method: "GET", state: "ENABLED" });
    }
    const r = w.run([]);
    expect(r.status, r.stderr).toBe(0);
    for (const job of TABLE) expect(w.state(job.name).state, job.name).toBe(job.state);
  });

  it("Ethan 1: istniejące zadanie ENABLED z harmonogramem zaparkowanym (przerwany przebieg) → pauza przed właściwym harmonogramem", () => {
    const w = world();
    const job = TABLE[0]!;
    w.seed(job.name, { schedule: "0 0 29 2 *", timeZone: "Europe/Warsaw", uri: SERVICE_URL + job.path, method: "GET", state: "ENABLED" });
    const r = w.run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(w.state(job.name)).toMatchObject({ state: "PAUSED", schedule: job.schedule });
    const mine = w.calls().filter((c) => nameOf(c) === job.name && /^(pause|update)/.test(verbOf(c)));
    expect(mine.map((c) => verbOf(c).split(" ")[0])).toEqual(["pause", "update"]);
  });

  it("Ethan 1: istniejące zadanie PAUSED z harmonogramem zaparkowanym → bez pause (API by odrzuciło), właściwy harmonogram", () => {
    const w = world();
    const job = TABLE[0]!;
    w.seed(job.name, { schedule: "0 0 29 2 *", timeZone: "Europe/Warsaw", uri: SERVICE_URL + job.path, method: "GET", state: "PAUSED" });
    const r = w.run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(w.state(job.name)).toMatchObject({ state: "PAUSED", schedule: job.schedule });
  });

  // Ethan (#137 @ b4bf4d0): odczyt harmonogramu bez `|| true` — błąd odczytu
  // nie może dać pustego tekstu, który pominąłby pauzę zaparkowanego zadania.
  it.each(["fail", "empty"])("odczyt harmonogramu istniejącego zadania: %s → kod ≠ 0, bez pause/update/create", (mode) => {
    const w = world();
    const job = TABLE[0]!;
    const seeded = { schedule: "0 0 29 2 *", timeZone: "Europe/Warsaw", uri: SERVICE_URL + job.path, method: "GET", state: "ENABLED" };
    w.seed(job.name, seeded);
    const r = w.run([], { FAKE_SCHEDULE_READ: mode });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`cannot read schedule of ${job.name}`);
    expect(w.calls().some((c) => /^(pause|update|create|resume)/.test(verbOf(c)))).toBe(false);
    expect(w.state(job.name)).toEqual(seeded);
  });

  it("--resume bez utworzonych zadań → błąd, nic nie wznowione", () => {
    const w = world();
    const r = w.run(["--resume", ...NAMES]);
    expect(r.status).toBe(1);
    expect(w.calls().some((c) => verbOf(c).startsWith("resume"))).toBe(false);
    expect(w.count()).toBe(0);
  });

  // Ryan (#137): wyjście gcloud z zasobem zadania — każde create/update http
  // z --format=none, każde wywołanie gcloud bez logu plikowego.
  it("create/update http zawsze z --format=none; każde wywołanie gcloud z CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1", () => {
    const w = world();
    const first = w.run([]);
    const second = w.run([]);
    const resume = w.run(["--resume", ...NAMES]);
    for (const r of [first, second, resume]) {
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
      expect(r.stdout.split("\n").filter((l) => l.includes("Authorization"))).toEqual([]);
    }
    const entries = w.entries();
    const writes = entries.filter((e) => /^(create|update) http$/.test(verbOf(e.a)));
    expect(writes.length).toBe(TABLE.length * 3);
    for (const e of writes) expect(e.a, verbOf(e.a)).toContain("--format=none");
    for (const e of entries) expect(e.env, e.a.join(" ")).toBe("1");
  });

  it("kontrola: fałszywy gcloud bez --format=none wypisuje zasób z nagłówkiem (jak prawdziwy)", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const job = TABLE[0]!;
    const r = spawnSync(join(BIN, "gcloud"), ["--project=my-helper-2-488419", "scheduler", "jobs", "update", "http", job.name, "--location=europe-central2", `--schedule=${job.schedule}`], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, FAKE_JOBS: w.jobs, FAKE_LOG: join(DIR, `log-${n++}`) },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(TOKEN);
  });

  // Oliver (pomiar): Scheduler odrzuca szybkie serie zmian kodem ABORTED.
  it("ABORTED dwa razy, potem sukces → ponowienie z odstępami 10, 20 s; wynik jak bez błędu", () => {
    const w = world();
    const r = w.run([], { FAKE_ABORTED_VERB: "update", FAKE_ABORTED_TIMES: "2" });
    expect(r.status, r.stderr).toBe(0);
    expect(w.sleeps()).toEqual([10, 20]);
    expect(r.stderr).toContain(`retry: ${TABLE[0]!.name}: ABORTED`);
    for (const job of TABLE) expect(w.state(job.name)).toMatchObject({ state: "PAUSED", schedule: job.schedule });
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  // Dwa odrzucenia = trzy próby: także drugie i kolejne ponowienie niesie nagłówek.
  it("ABORTED przy create: każda próba z nagłówkiem w pliku flag (strumień tworzony od nowa)", () => {
    const w = world();
    const r = w.run([], { FAKE_ABORTED_VERB: "create", FAKE_ABORTED_TIMES: "2" });
    expect(r.status, r.stderr).toBe(0);
    const creates = w.entries().filter((e) => verbOf(e.a) === "create http" && nameOf(e.a) === TABLE[0]!.name);
    expect(creates).toHaveLength(3);
    for (const e of creates) expect(e.ff).toBe(`--headers:\n  Authorization: "Bearer ${TOKEN}"\n`);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it("ABORTED przy update istniejącego zadania (rotacja): każda próba z --update-headers", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const before = w.entries().length;
    const r = w.run([], { FAKE_ABORTED_VERB: "update", FAKE_ABORTED_TIMES: "2" });
    expect(r.status, r.stderr).toBe(0);
    const updates = w.entries().slice(before).filter((e) => verbOf(e.a) === "update http" && nameOf(e.a) === TABLE[0]!.name);
    expect(updates).toHaveLength(3);
    for (const e of updates) expect(e.ff).toBe(`--update-headers:\n  Authorization: "Bearer ${TOKEN}"\n`);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  // Po wyczerpaniu prób na kroku, po którym nic już nie sprawdza skutku
  // (update właściwego harmonogramu): stop, a nie przejście do kolejnych zadań.
  it("ABORTED bez końca przy update → kod 1, zadanie niezgłoszone jako utworzone, następne nie powstają", () => {
    const w = world();
    const r = w.run([], { FAKE_ABORTED_VERB: "update", FAKE_ABORTED_TIMES: "inf" });
    const name = TABLE[0]!.name;
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`error: ${name}: Scheduler still rejects changes (ABORTED)`);
    expect(w.sleeps()).toEqual([10, 20, 40, 60, 60]);
    expect(w.count()).toBe(1);
    expect(r.stdout).not.toContain(`created ${name}`);
    expect(w.calls().filter((c) => verbOf(c) === "create http")).toHaveLength(1);
  });

  it("ABORTED bez końca → kod ≠ 0 z nazwą zadania po 10, 20, 40, 60, 60 s; dalej nic; ponowny przebieg kończy pracę", () => {
    const w = world();
    const r = w.run([], { FAKE_ABORTED_VERB: "pause", FAKE_ABORTED_TIMES: "inf" });
    const name = TABLE[0]!.name;
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`error: ${name}: Scheduler still rejects changes (ABORTED)`);
    expect(w.sleeps()).toEqual([10, 20, 40, 60, 60]);
    expect(w.sleeps().reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    expect(w.calls().filter((c) => verbOf(c).startsWith("pause"))).toHaveLength(6);
    expect(w.calls().some((c) => verbOf(c).startsWith("update"))).toBe(false);
    expect(w.count()).toBe(1);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    // Idempotentnie: przerwany przebieg (zadanie ENABLED z harmonogramem zaparkowanym) da się puścić jeszcze raz.
    const again = w.run([]);
    expect(again.status, again.stderr).toBe(0);
    for (const job of TABLE) expect(w.state(job.name)).toMatchObject({ state: "PAUSED", schedule: job.schedule });
  });

  it("inny błąd niż ABORTED → bez ponawiania, kod 1, nagłówek ze stderr gcloud nie trafia na wyjście", () => {
    const w = world();
    const r = w.run([], { FAKE_FAIL_VERB: "create" });
    expect(r.status).toBe(1);
    expect(w.sleeps()).toEqual([]);
    expect(w.calls().filter((c) => verbOf(c) === "create http")).toHaveLength(1);
    expect(r.stderr).toContain(`failed for ${TABLE[0]!.name}`);
    expect(r.stderr).toContain("PERMISSION_DENIED");
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it("inny błąd niż ABORTED przy update (bez kontroli stanu po nim) → kod 1, stop, następne zadania nie powstają", () => {
    const w = world();
    const r = w.run([], { FAKE_FAIL_VERB: "update" });
    const name = TABLE[0]!.name;
    expect(r.status).toBe(1);
    expect(w.sleeps()).toEqual([]);
    expect(r.stderr).toContain(`failed for ${name}`);
    expect(w.calls().filter((c) => verbOf(c) === "update http")).toHaveLength(1);
    expect(w.count()).toBe(1);
    expect(r.stdout).not.toContain(`created ${name}`);
  });

  it.each(["create", "update"])(
    "D-8: gcloud cytuje token w stderr bez słów nagłówka (%s) → linia z tokenem odfiltrowana, reszta stderr widoczna",
    (verb) => {
      const w = world();
      // update z nagłówkiem (--update-headers) dotyczy istniejącego zadania: najpierw zwykły przebieg.
      if (verb === "update") expect(w.run([]).status).toBe(0);
      const r = w.run([], { FAKE_ECHO_TOKEN_VERB: verb });
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
      expect(r.stderr).not.toContain("INVALID_ARGUMENT");
      expect(r.stderr).not.toContain(TOKEN.slice(0, 8));
      expect(r.stderr).not.toMatch(/authorization|bearer/i);
      expect(r.stderr).toContain("hint: check the job definition");
      expect(r.stderr).toContain(`failed for ${TABLE[0]!.name}`);
    },
  );

  it("token z sekretu nigdy w argumentach gcloud ani na wyjściu", () => {
    const w = world();
    const r = w.run([]);
    expect(w.calls().length).toBeGreaterThan(0);
    expect(JSON.stringify(w.calls())).not.toContain(TOKEN);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it("B-1: create i update z nagłówkiem bez lokalnego logu gcloud; update niesie nagłówek (rotacja)", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    expect(w.run([]).status).toBe(0);
    const withFlags = w.entries().filter((e) => e.ff !== null);
    const creates = withFlags.filter((e) => verbOf(e.a) === "create http");
    const updates = withFlags.filter((e) => verbOf(e.a) === "update http");
    expect(creates).toHaveLength(TABLE.length);
    expect(updates).toHaveLength(TABLE.length);
    for (const e of creates) expect(e.ff).toBe(`--headers:\n  Authorization: "Bearer ${TOKEN}"\n`);
    for (const e of updates) expect(e.ff).toBe(`--update-headers:\n  Authorization: "Bearer ${TOKEN}"\n`);
    for (const e of withFlags) expect(e.env, verbOf(e.a)).toBe("1");
    // Ponowny przebieg: każde update istniejącego zadania ma nagłówek.
    const allUpdates = w.entries().filter((e) => verbOf(e.a) === "update http" && !e.a.includes(`--schedule=0 0 29 2 *`));
    const second = allUpdates.slice(-TABLE.length);
    for (const e of second) expect(e.ff, nameOf(e.a)).not.toBeNull();
  });

  it("W-1: token czytany raz, przed pierwszą zmianą; --check i --resume go nie czytają", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const calls = w.calls();
    const secrets = calls.map((c, i) => [c, i] as const).filter(([c]) => c[0] === "secrets" || c.includes("secrets"));
    expect(secrets).toHaveLength(1);
    expect(secrets[0]![1]).toBe(0);
    expect(secrets[0]![0]).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--format/)]));
    const before = calls.length;
    w.run(["--check"]);
    w.run(["--resume", ...NAMES]);
    expect(w.calls().slice(before).some((c) => c.includes("secrets"))).toBe(false);
  });

  it.each([
    ["błąd odczytu", { FAKE_SECRET_FAIL: "1" }, /cannot read secret/],
    ["pusty token", { FAKE_TOKEN: "" }, /is empty/],
    ["znak spoza zbioru", { FAKE_TOKEN: 'abc"def' }, /outside/],
    ["nowa linia", { FAKE_TOKEN: "abc\ndef" }, /outside/],
  ])("W-1: %s → stop przed pierwszą zmianą w Scheduler, wartość niewypisana", (_l, extra, msg) => {
    const w = world();
    const r = w.run([], extra as Record<string, string>);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(w.calls().filter((c) => c[0] !== "secrets" && !c.includes("secrets"))).toEqual([]);
    expect(w.count()).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("def");
  });

  it.each([
    ["adres taga", "https://sha-1234567---myhelper-843777043748.europe-central2.run.app"],
    ["inny host", "https://example.com"],
    ["http", "http://myhelper-843777043748.europe-central2.run.app"],
    ["sufiks hosta", "https://myhelper-843777043748.europe-central2.run.app.example.com"],
    ["dane logowania w adresie", "https://x@myhelper-843777043748.europe-central2.run.app"],
    ["ścieżka", "https://myhelper-843777043748.europe-central2.run.app/api"],
    ["port", "https://myhelper-843777043748.europe-central2.run.app:8443"],
    ["inna usługa", "https://myhelperx-843777043748.europe-central2.run.app"],
  ])("BASE_URL %s → kod 2 przed gcloud (#143 pkt 1)", (_l, url) => {
    const w = world();
    const r = w.run([], { BASE_URL: url });
    expect(r.status).toBe(2);
    expect(w.calls()).toEqual([]);
  });

  it("BASE_URL z końcowym ukośnikiem = główny adres usługi", () => {
    const w = world();
    const r = w.run([], { BASE_URL: SERVICE_URL + "/" });
    expect(r.status, r.stderr).toBe(0);
    expect(w.state(TABLE[0]!.name).uri).toBe(SERVICE_URL + TABLE[0]!.path);
  });

  it.each([["--bogus"], ["--check", "--resume"], ["--check", "mh-sms-reminders"]])("nieznany tryb %j → kod 2 przed gcloud", (...args) => {
    const w = world();
    expect(w.run(args).status).toBe(2);
    expect(w.calls()).toEqual([]);
    expect(existsSync(w.jobs)).toBe(true);
  });
});

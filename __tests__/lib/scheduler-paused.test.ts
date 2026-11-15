// @vitest-environment node
/**
 * Strażnik G-C5b (krok D, K-3; #121 j): `infra/gcp/scheduler.sh` z podstawionym
 * `gcloud` (stan zadań w plikach), więc sprawdzamy zachowanie, nie tekst:
 *  - nowe zadanie: create z harmonogramem zaparkowanym (29 lutego) → pause →
 *    odczyt stanu = PAUSED → dopiero wtedy właściwy harmonogram;
 *  - tryb domyślny nigdy nie wznawia; po nim wszystko jest PAUSED;
 *  - pauza, która nie zadziałała → stop z kodem 1, kolejne zadania nie powstają;
 *  - --resume wznawia tylko zadania ENABLED z tabeli, wymaga istnienia zadań;
 *  - --check: dryf przed --resume, zgodność po nim;
 *  - token z sekretu nigdy w argumentach.
 * Mutacje (wynik w PR): create z właściwym harmonogramem; bez pause po create;
 * bez odczytu stanu; resume w trybie domyślnym; --resume wznawia zadania PAUSED.
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
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + "\\n");
const flag = (k) => { const f = a.find((x) => x.startsWith("--" + k + "=")); return f && f.slice(k.length + 3); };
const pos = a.filter((x) => !x.startsWith("--"));
if (pos[0] === "secrets") { process.stdout.write(process.env.FAKE_TOKEN); process.exit(0); }
const verb = pos[2], name = verb === "create" || verb === "update" ? pos[4] : pos[3];
const file = path.join(process.env.FAKE_JOBS, name + ".json");
const job = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
const save = (j) => fs.writeFileSync(file, JSON.stringify(j));
if (verb === "describe") {
  if (!job) process.exit(1);
  const fmt = flag("format");
  if (fmt === "value(name)") console.log(name);
  else if (fmt === "value(state)") console.log(job.state);
  else console.log([job.schedule, job.timeZone, job.uri, job.method, job.state].join("\\t"));
} else if (verb === "create") {
  if (job) process.exit(1);
  const ff = fs.readFileSync(flag("flags-file"), "utf8");
  if (!ff.includes("Authorization")) process.exit(3);
  save({ schedule: flag("schedule"), timeZone: flag("time-zone"), uri: flag("uri"), method: flag("http-method"), state: "ENABLED" });
} else if (verb === "update") {
  if (!job) process.exit(1);
  for (const [k, f] of [["schedule", "schedule"], ["timeZone", "time-zone"], ["uri", "uri"], ["method", "http-method"]]) if (flag(f)) job[k] = flag(f);
  save(job);
} else if (verb === "pause") {
  if (!job) process.exit(1);
  if (!process.env.FAKE_PAUSE_NOOP) job.state = "PAUSED";
  save(job);
} else if (verb === "resume") {
  if (!job) process.exit(1);
  job.state = "ENABLED"; save(job);
}
`,
);
chmodSync(join(BIN, "gcloud"), 0o755);

let n = 0;
function world() {
  const jobs = join(DIR, `jobs-${n++}`);
  mkdirSync(jobs);
  const log = join(DIR, `log-${n++}`);
  writeFileSync(log, "");
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${BIN}:${process.env.PATH}`,
        PROJECT_ID: "my-helper-2-488419",
        REGION: "europe-central2",
        BASE_URL: "https://sha-1234567---myhelper-843777043748.europe-central2.run.app",
        FAKE_JOBS: jobs,
        FAKE_LOG: log,
        FAKE_TOKEN: TOKEN,
        ...extra,
      },
    });
    return { ...r, log: readFileSync(log, "utf8") };
  };
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
  const state = (name: string) => JSON.parse(readFileSync(join(jobs, `${name}.json`), "utf8")) as Record<string, string>;
  const count = () => readdirSync(jobs).length;
  const seed = (name: string, j: Record<string, string>) => writeFileSync(join(jobs, `${name}.json`), JSON.stringify(j));
  return { run, calls, state, count, seed, jobs };
}

const verbOf = (c: string[]) => c.filter((x) => !x.startsWith("--")).slice(2, 4).join(" ");
const nameOf = (c: string[]) => {
  const p = c.filter((x) => !x.startsWith("--"));
  return p[2] === "create" || p[2] === "update" ? p[4] : p[3];
};

describe("G-C5b: tworzenie wstrzymane (#121 j)", () => {
  it("tabela zadań wczytana (8), notifications PAUSED", () => {
    expect(TABLE).toHaveLength(8);
    expect(TABLE.filter((j) => j.state === "PAUSED").map((j) => j.path).every((p) => p.startsWith("/api/notifications/"))).toBe(true);
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
      expect(seq, job.name).toEqual(["create", "pause", "state", "update", "state"]);
      expect(mine[0]).toContain("--schedule=0 0 29 2 *");
      expect(mine[3]).toContain(`--schedule=${job.schedule}`);
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

  it("istniejące włączone zadanie, które w tabeli jest PAUSED → wstrzymane", () => {
    const w = world();
    const job = TABLE.find((j) => j.state === "PAUSED")!;
    w.seed(job.name, { schedule: job.schedule, timeZone: "Europe/Warsaw", uri: "x", method: "GET", state: "ENABLED" });
    expect(w.run([]).status).toBe(0);
    expect(w.state(job.name).state).toBe("PAUSED");
  });

  it("--check: dryf przed --resume; --resume wznawia tylko ENABLED; potem --check = 0", () => {
    const w = world();
    expect(w.run([]).status).toBe(0);
    const pre = w.run(["--check"]);
    expect(pre.status).toBe(1);
    expect(pre.stdout).toMatch(/DRIFT mh-sms-reminders/);
    const res = w.run(["--resume"]);
    expect(res.status, res.stderr).toBe(0);
    for (const job of TABLE) expect(w.state(job.name).state, job.name).toBe(job.state);
    const post = w.run(["--check"]);
    expect(post.status, post.stdout).toBe(0);
  });

  it("--resume bez utworzonych zadań → błąd, nic nie wznowione", () => {
    const w = world();
    const r = w.run(["--resume"]);
    expect(r.status).toBe(1);
    expect(w.calls().some((c) => verbOf(c).startsWith("resume"))).toBe(false);
    expect(w.count()).toBe(0);
  });

  it("token z sekretu nigdy w argumentach gcloud", () => {
    const w = world();
    w.run([]);
    expect(w.calls().length).toBeGreaterThan(0);
    expect(JSON.stringify(w.calls())).not.toContain(TOKEN);
  });

  it.each([["--bogus"], ["--check", "--resume"]])("nieznany tryb %j → kod 2 przed gcloud", (...args) => {
    const w = world();
    expect(w.run(args).status).toBe(2);
    expect(w.calls()).toEqual([]);
    expect(existsSync(w.jobs)).toBe(true);
  });
});

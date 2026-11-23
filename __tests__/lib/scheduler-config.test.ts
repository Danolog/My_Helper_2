// @vitest-environment node
/**
 * Strażnik G-C5 (brief C §4, 7): `infra/gcp/scheduler.sh` zgodny z trasami.
 *  - każda ścieżka zadania ma `route.ts` z `requireCronSecret` i eksportem `GET`,
 *  - każdy katalog `src/app/api/cron/*` ma zadanie w skrypcie,
 *  - strefa `Europe/Warsaw`, metoda GET, stan ENABLED|PAUSED,
 *  - zadań z wiadomościami do klientów (notifications) nie ma do R3-C
 *    (Oliver); gdyby wróciły — tylko PAUSED,
 *  - zadanie trasy zamrożonego modułu (`hardOff`, `frozenModuleForApiPath`)
 *    tylko PAUSED — `--resume` odrzuca takie zadanie przed gcloud,
 *  - każde `gcloud` idzie przez tablicę z jawnym `--project`,
 *  - sekret idzie przez `--flags-file` ze strumienia, nie w argumencie.
 * Mutacja: dodać `src/app/api/cron/nowy/route.ts` bez wpisu w skrypcie → czerwony.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frozenModuleForApiPath } from "@/lib/features";

const ROOT = process.cwd();
const SCRIPT = readFileSync(join(ROOT, "infra/gcp/scheduler.sh"), "utf8");

type Job = { name: string; path: string; schedule: string; state: string };

function jobs(): Job[] {
  const block = SCRIPT.match(/^JOBS=\(\n([\s\S]*?)^\)/m);
  if (!block) throw new Error("Brak tablicy JOBS=( … ) w scheduler.sh");
  return block[1]!
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith('"'))
    .map((l) => {
      const [name, path, schedule, state] = l.replace(/^"|"$/g, "").split("|");
      return { name: name!, path: path!, schedule: schedule!, state: state! };
    });
}

const JOBS = jobs();

/**
 * Zamknięta lista tras crona bez zadania w skrypcie: harmonogram dochodzi
 * osobnym krokiem infrastruktury (zmiana produkcji). Do tego czasu trasa
 * istnieje, ale nikt jej nie woła. Dopisanie pozycji = zmiana przypiętej listy.
 */
const CRON_ROUTES_AWAITING_SCHEDULE = ["/api/cron/cleanup-expired-auth"];

function routeFile(path: string): string {
  return join(ROOT, "src/app", path, "route.ts");
}

describe("G-C5: scheduler.sh ↔ trasy", () => {
  it("tabela zadań nie jest pusta, nazwy i ścieżki unikalne", () => {
    expect(JOBS.length).toBeGreaterThan(0);
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
    expect(new Set(JOBS.map((j) => j.path)).size).toBe(JOBS.length);
  });

  it.each(JOBS)("$name: $path ma route.ts z requireCronSecret i GET", ({ path }) => {
    expect(path).toMatch(/^\/api\/[a-z0-9/-]+$/);
    const file = routeFile(path);
    expect(existsSync(file), file).toBe(true);
    const src = readFileSync(file, "utf8");
    expect(src).toContain("requireCronSecret");
    expect(src).toMatch(/export\s+(async\s+function\s+GET|const\s+GET)\b/);
  });

  it("każdy katalog src/app/api/cron/* ma zadanie w skrypcie (poza zamkniętą listą tras czekających na harmonogram)", () => {
    const dirs = readdirSync(join(ROOT, "src/app/api/cron"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/api/cron/${d.name}`);
    const paths = new Set(JOBS.map((j) => j.path));
    expect(dirs.filter((d) => !paths.has(d) && !CRON_ROUTES_AWAITING_SCHEDULE.includes(d))).toEqual([]);
  });

  it("lista tras czekających na harmonogram: przypięta, każda istnieje i nie ma jeszcze zadania", () => {
    expect(CRON_ROUTES_AWAITING_SCHEDULE).toEqual(["/api/cron/cleanup-expired-auth"]);
    const paths = new Set(JOBS.map((j) => j.path));
    for (const p of CRON_ROUTES_AWAITING_SCHEDULE) {
      expect(existsSync(routeFile(p)), p).toBe(true);
      // Gdy zadanie trafi do skryptu, pozycja schodzi z listy (wtedy działa reguła główna).
      expect(paths.has(p), p).toBe(false);
    }
  });

  it("harmonogram: 5 pól crona, stan ENABLED|PAUSED", () => {
    for (const j of JOBS) {
      expect(j.schedule.split(" "), j.name).toHaveLength(5);
      expect(["ENABLED", "PAUSED"], j.name).toContain(j.state);
    }
  });

  it("bez zadań z wiadomościami do klientów (mh-notify-*, /api/notifications/*) do R3-C", () => {
    const notify = JOBS.filter((j) => j.path.startsWith("/api/notifications/") || j.name.startsWith("mh-notify-"));
    expect(notify).toEqual([]);
    expect(JOBS.every((j) => j.path.startsWith("/api/cron/"))).toBe(true);
    for (const j of JOBS.filter((x) => x.path.startsWith("/api/notifications/"))) expect(j.state, j.name).toBe("PAUSED");
  });

  it("zadanie trasy zamrożonego modułu (hardOff w features.ts) jest PAUSED — --resume go nie wznowi", () => {
    const frozen = JOBS.filter((j) => frozenModuleForApiPath(j.path) !== null);
    // Dziś: moduł pushNotifications (crony push-reminders i push-reminders-24h).
    expect(frozen.map((j) => j.name).sort()).toEqual(
      JOBS.filter((j) => /^\/api\/cron\/push-reminders(-24h)?$/.test(j.path)).map((j) => j.name).sort()
    );
    for (const j of frozen) expect(j.state, `${j.name} (${frozenModuleForApiPath(j.path)})`).toBe("PAUSED");
  });

  it("strefa Europe/Warsaw i metoda GET", () => {
    expect(SCRIPT).toMatch(/^TIME_ZONE="Europe\/Warsaw"$/m);
    expect(SCRIPT).toContain("--http-method=GET");
    expect(SCRIPT).toContain('--time-zone="$TIME_ZONE"');
  });

  it("każde gcloud z jawnym --project (przez tablicę GC), nigdy domyślny projekt", () => {
    expect(SCRIPT).toMatch(/^GC=\(gcloud --project="\$PROJECT_ID" --quiet\)$/m);
    const code = SCRIPT.split("\n").filter((l) => !l.trim().startsWith("#"));
    const bare = code.filter((l) => /\bgcloud\b/.test(l) && !l.startsWith("GC=("));
    expect(bare).toEqual([]);
  });

  it("brak PROJECT_ID/REGION/BASE_URL kończy się błędem przed pierwszym gcloud", () => {
    const check = SCRIPT.indexOf("missing required env");
    const firstGcloud = SCRIPT.search(/"\$\{GC\[@\]\}"/);
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstGcloud);
  });

  it("sekret: tylko --flags-file ze strumienia, nigdy w argumencie --headers", () => {
    expect(SCRIPT).toContain("--flags-file=<(auth_flags");
    const code = SCRIPT.split("\n").filter((l) => !l.trim().startsWith("#"));
    expect(code.some((l) => /--(update-)?headers[= ]/.test(l) && !l.includes("auth_flags"))).toBe(false);
  });
});

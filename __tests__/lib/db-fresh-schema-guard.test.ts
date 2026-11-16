// @vitest-environment node
/**
 * #180: świeża baza tylko przez `db:migrate`, strażnik ograniczeń z 0009.
 *
 * - strażnik (`scripts/db-schema-guard.ts`): decyzja i zapytanie tylko do odczytu;
 * - `db:reset` (`scripts/db-reset-local.ts`): baza z twardej listy, host lokalny,
 *   kolejność migrate → push → strażnik, bez `drizzle-kit drop`;
 * - `package.json`: `db:push`/`db:dev` kończą się strażnikiem, nie ma martwego
 *   `setup`, każdy skrypt `scripts/*.ts` wołany z package.json istnieje;
 * - `init.sh`: migrate przed push, bez wyciszania błędów;
 * - CI (`quality-gate.yml`): każdy `db:push` po `db:migrate`, z POSTGRES_URL —
 *   strażnik na końcu `db:push` przechodzi;
 * - README: zdanie o budowaniu bazy, bez fałszywego „drop all tables”.
 * Bez połączenia z bazą (prawdziwa baza: `__tests__/pg/schema-constraints.pg.test.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RESET_ALLOWED_DATABASES,
  RESET_DEFAULT_DATABASE,
  RESET_STEPS,
  planReset,
} from "../../scripts/db-reset-local";
import {
  REQUIRED_CONSTRAINTS,
  SCHEMA_GUARD_SQL,
  checkSchemaConstraints,
  runSchemaGuard,
} from "../../scripts/db-schema-guard";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const PKG = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const INIT = read("init.sh");
const QG = read(".github/workflows/quality-gate.yml");
const README = read("README.md");
const GUARD_CMD = "tsx scripts/db-schema-guard.ts";
const LOCAL = "postgresql://dev_user:pw-x9@localhost:5432/pos_dev";

describe("strażnik schematu — decyzja", () => {
  it("komplet trzech ograniczeń 0009 → ok", () => {
    expect(REQUIRED_CONSTRAINTS).toEqual([
      "appointments_no_overlap",
      "appointments_end_after_start",
      "time_blocks_end_after_start",
    ]);
    expect(checkSchemaConstraints([...REQUIRED_CONSTRAINTS, "inne_ograniczenie"])).toEqual({ ok: true });
  });

  it("brak EXCLUDE (baza zbudowana pushem) → odmowa z nazwą i instrukcją db:migrate", () => {
    const r = checkSchemaConstraints(["appointments_end_after_start", "time_blocks_end_after_start"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["appointments_no_overlap"]);
    expect(r.message).toBe(
      "Brak appointments_no_overlap — baza zbudowana bez db:migrate. Uruchom pnpm db:migrate (nie samo db:push); od zera: pnpm db:reset."
    );
  });

  it.each([
    ["brak CHECK wizyt", ["appointments_no_overlap", "time_blocks_end_after_start"], ["appointments_end_after_start"]],
    ["brak CHECK blokad", ["appointments_no_overlap", "appointments_end_after_start"], ["time_blocks_end_after_start"]],
    ["pusta baza", [], [...REQUIRED_CONSTRAINTS]],
  ])("%s → odmowa z listą braków", (_n, present, missing) => {
    const r = checkSchemaConstraints(present);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(missing);
  });

  it("nazwa podobna (prefiks) nie zastępuje ograniczenia", () => {
    expect(checkSchemaConstraints(["appointments_no_overlap_old", "appointments_end_after_start", "time_blocks_end_after_start"]).ok).toBe(false);
  });

  it("zapytanie tylko do odczytu, o wszystkie trzy nazwy", () => {
    expect(SCHEMA_GUARD_SQL).toMatch(/^select conname from pg_constraint where conname in \(/);
    expect(SCHEMA_GUARD_SQL).not.toMatch(/;|\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    for (const n of REQUIRED_CONSTRAINTS) expect(SCHEMA_GUARD_SQL).toContain(`'${n}'`);
  });

  it("runSchemaGuard: wynik zapytania → decyzja", async () => {
    const unsafe = vi.fn().mockResolvedValue([{ conname: "appointments_end_after_start" }]);
    const r = await runSchemaGuard({ unsafe } as never);
    expect(unsafe).toHaveBeenCalledWith(SCHEMA_GUARD_SQL);
    expect(r.ok).toBe(false);
  });
});

describe("db:reset — plan (bez połączenia)", () => {
  it("domyślnie pos_dev; lista twarda: pos_dev, pos_reset_test", () => {
    expect(RESET_DEFAULT_DATABASE).toBe("pos_dev");
    expect(RESET_ALLOWED_DATABASES).toEqual(["pos_dev", "pos_reset_test"]);
    const p = planReset([], LOCAL);
    expect(p).toMatchObject({ ok: true, database: "pos_dev" });
  });

  it("pos_reset_test: kroki dostają adres TEJ bazy, admin łączy się z bazą postgres, hasło zachowane", () => {
    const p = planReset(["pos_reset_test"], LOCAL);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.targetUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/pos_reset_test");
    expect(p.adminUrl).toBe("postgresql://dev_user:pw-x9@localhost:5432/postgres");
  });

  it.each([["pos_prod"], ["postgres"], ["pos_dev2"], ["POS_DEV"], ["pos_dev\"; drop database x; --"], [""]])(
    "baza %j spoza listy → odmowa, bez adresu w komunikacie",
    (name) => {
      const p = planReset([name], LOCAL);
      expect(p.ok).toBe(false);
      if (p.ok) return;
      expect(p.reason).toContain("spoza listy (pos_dev, pos_reset_test)");
      expect(p.reason).not.toContain("pw-x9");
      expect(p.reason).not.toContain("drop database");
    }
  );

  it.each([
    ["Neon", "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/pos_dev"],
    ["zdalny host", "postgresql://u:p@db.example.com:5432/pos_dev"],
    ["brak adresu", undefined],
  ])("%s → odmowa", (_n, url) => {
    const p = planReset(["pos_dev"], url);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/^db:reset odmawia: /);
  });

  it("VERCEL_ENV=production → odmowa", () => {
    expect(planReset([], LOCAL, { VERCEL_ENV: "production" }).ok).toBe(false);
  });

  it("kroki po założeniu bazy: migrate → push → strażnik, bez drizzle-kit drop", () => {
    const flat = RESET_STEPS.map((s) => s.join(" "));
    expect(flat).toEqual([
      "pnpm exec drizzle-kit migrate",
      "pnpm exec drizzle-kit push",
      "pnpm exec tsx scripts/db-schema-guard.ts",
    ]);
  });

  it("skrypt resetu nie używa DROP … WITH (FORCE) i sprawdza inne połączenia", () => {
    const src = read("scripts/db-reset-local.ts");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/FORCE/i);
    expect(src).toContain("pg_stat_activity");
  });
});

describe("package.json", () => {
  it("db:push i db:dev: push, potem strażnik", () => {
    expect(PKG.scripts["db:push"]).toBe(`drizzle-kit push && ${GUARD_CMD}`);
    expect(PKG.scripts["db:dev"]).toBe(`drizzle-kit push && ${GUARD_CMD}`);
  });

  it("db:reset przez db-reset-local; żaden skrypt nie woła drizzle-kit drop", () => {
    expect(PKG.scripts["db:reset"]).toBe("tsx scripts/db-reset-local.ts");
    for (const [name, cmd] of Object.entries(PKG.scripts)) {
      expect(cmd, name).not.toMatch(/drizzle-kit\s+drop/);
    }
  });

  it("martwy skrypt setup usunięty; każdy scripts/*.ts wołany z package.json istnieje", () => {
    expect(PKG.scripts).not.toHaveProperty("setup");
    const referenced = Object.values(PKG.scripts).flatMap((c) => c.match(/scripts\/[\w./-]+\.ts/g) ?? []);
    expect(referenced.length).toBeGreaterThan(0);
    for (const f of referenced) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });

  it("db:migrate bez zmian (drizzle-kit migrate)", () => {
    expect(PKG.scripts["db:migrate"]).toBe("drizzle-kit migrate");
  });
});

describe("init.sh", () => {
  it("schemat przez migracje: db:migrate przed db:push, bez samego drizzle-kit push", () => {
    expect(INIT).toContain("pnpm db:migrate && pnpm db:push");
    expect(INIT).not.toMatch(/drizzle-kit push/);
  });

  it("błąd bazy nie jest wyciszany i przerywa skrypt", () => {
    const dbLines = INIT.split("\n").filter((l) => /db:(migrate|push)|drizzle-kit/.test(l));
    for (const l of dbLines) expect(l, l).not.toContain("2>/dev/null");
    expect(INIT).toMatch(/if ! \{ pnpm db:migrate && pnpm db:push; \}; then\n[^\n]*\n\s+exit 1/);
  });
});

describe("CI (quality-gate.yml): strażnik na końcu db:push przechodzi", () => {
  // Każdy job z `pnpm db:push`: wcześniej `pnpm db:migrate` w tym samym jobie,
  // a job ma POSTGRES_URL (strażnik czyta ten sam adres co drizzle-kit).
  const jobs = QG.split(/\n {2}(?=[\w-]+:\n)/).filter((j) => j.includes("run: pnpm db:push"));

  it("są joby z db:push (E2E Smoke i Full)", () => {
    expect(jobs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(jobs.map((j, i) => [i, j] as const))("job %i: db:migrate przed db:push, POSTGRES_URL ustawiony", (_i, job) => {
    const migrate = job.indexOf("run: pnpm db:migrate");
    const push = job.indexOf("run: pnpm db:push");
    expect(migrate).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(push);
    expect(job).toMatch(/POSTGRES_URL: postgresql:\/\/[^\n]*@localhost:5432\/pos_dev/);
  });
});

describe("README", () => {
  it("zdanie o budowaniu bazy od zera, bez fałszywego „drop all tables”", () => {
    expect(README).toContain(
      "Bazę od zera buduje `pnpm db:migrate` (`pnpm db:reset` i `init.sh` robią to same); `db:push` tylko po migracjach"
    );
    expect(README).not.toMatch(/drop all tables/i);
  });
});

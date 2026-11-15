import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { checkSeedTarget, SEED_ALLOWED_HOSTS } from "../../scripts/seed-host-guard";

/**
 * Guard hosta seeda testowego. Testujemy tylko czystą funkcję; seed nie jest
 * uruchamiany, a `scripts/seed-test.ts` nie jest importowany (łączy się z bazą).
 */

const SECRET = "S3cr3t-P4ss_xyz";

function reasonOf(result: ReturnType<typeof checkSeedTarget>): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("checkSeedTarget — allowlista", () => {
  it.each([
    ["postgresql://dev_user:dev_password@localhost:5432/pos_dev", "localhost"],
    ["postgres://dev_user:dev_password@127.0.0.1:5432/pos_dev", "127.0.0.1"],
    ["postgresql://dev_user:dev_password@[::1]:5432/pos_dev", "::1"],
    ["postgresql://dev_user:dev_password@LOCALHOST/pos_dev", "localhost"],
  ])("przepuszcza %s", (url, host) => {
    expect(checkSeedTarget(url)).toEqual({ ok: true, host });
  });

  it("przepuszcza URL z workflow CI (quality-gate.yml)", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/quality-gate.yml"), "utf8");
    const urls = [...workflow.matchAll(/POSTGRES_URL:\s*(\S+)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(checkSeedTarget(url).ok).toBe(true);
    }
  });

  it("przepuszcza VERCEL_ENV=development na localhost", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost/db", { VERCEL_ENV: "development" }).ok).toBe(true);
  });

  it("odrzuca hosty spoza allowlisty", () => {
    for (const host of ["db.example.com", "10.0.0.5", "localhost.evil.com", "postgres"]) {
      const reason = reasonOf(checkSeedTarget(`postgresql://u:p@${host}:5432/db`));
      expect(reason).toContain("spoza allowlisty");
    }
  });

  it("allowlista zawiera tylko hosty lokalne", () => {
    expect([...SEED_ALLOWED_HOSTS].sort()).toEqual(["127.0.0.1", "::1", "localhost"]);
  });
});

describe("checkSeedTarget — Neon", () => {
  it.each([
    "postgresql://neondb_owner:pw@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    "postgresql://u:pw@EP-X-POOLER.US-EAST-2.AWS.NEON.TECH/db",
    "postgresql://u:pw@neon.tech/db",
  ])("jawnie odrzuca %s", (url) => {
    expect(reasonOf(checkSeedTarget(url))).toContain("Neon");
  });

  it("nie da się obejść Neona hasłem z @ (WHATWG bierze ostatni @)", () => {
    const reason = reasonOf(checkSeedTarget("postgresql://u:p@localhost@ep-x.neon.tech/db"));
    expect(reason).toContain("Neon");
  });

  it("odrzuca multi-host (postgres.js łączy się po kolei z każdym)", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost:5432,ep-x.neon.tech:5432/db").ok).toBe(false);
  });
});

describe("checkSeedTarget — VERCEL_ENV", () => {
  it.each(["preview", "production", "Production", " preview "])(
    "odrzuca VERCEL_ENV=%j nawet na localhost",
    (vercelEnv) => {
      const reason = reasonOf(checkSeedTarget("postgresql://u:p@localhost/db", { VERCEL_ENV: vercelEnv }));
      expect(reason).toContain("VERCEL_ENV");
    },
  );
});

describe("checkSeedTarget — URL bez hosta i nieprawidłowy", () => {
  it.each([undefined, "", "   "])("odrzuca brak POSTGRES_URL (%j)", (url) => {
    expect(reasonOf(checkSeedTarget(url))).toContain("wymagany");
  });

  it("odrzuca URL bez hosta (postgres.js wziąłby PGHOST z env)", () => {
    expect(reasonOf(checkSeedTarget("postgresql:///pos_dev"))).toContain("nie zawiera hosta");
  });

  it("odrzuca napis, który nie jest URL", () => {
    expect(reasonOf(checkSeedTarget("localhost:5432/pos_dev"))).not.toBe("");
  });

  it("odrzuca inny schemat niż postgres", () => {
    expect(reasonOf(checkSeedTarget("mysql://u:p@localhost/db"))).toContain("schemat");
  });
});

describe("checkSeedTarget — hasło nie wycieka do komunikatu", () => {
  it.each([
    `postgresql://owner:${SECRET}@ep-x.eu-central-1.aws.neon.tech/neondb`,
    `postgresql://owner:${SECRET}@db.example.com:5432/db`,
    `postgresql://owner:${SECRET}@localhost:5432,db.example.com/db`,
    `not a url ${SECRET}`,
    `mysql://owner:${SECRET}@localhost/db`,
    `postgresql://owner:${SECRET}@/db`,
  ])("komunikat dla %s nie zawiera hasła ani użytkownika", (url) => {
    const reason = reasonOf(checkSeedTarget(url));
    expect(reason).not.toContain(SECRET);
    expect(reason).not.toContain(encodeURIComponent(SECRET));
    expect(reason).not.toContain("owner");
  });

  it("komunikat dla VERCEL_ENV nie zawiera hasła", () => {
    const reason = reasonOf(
      checkSeedTarget(`postgresql://owner:${SECRET}@localhost/db`, { VERCEL_ENV: "production" }),
    );
    expect(reason).not.toContain(SECRET);
  });
});

describe("seed-test.ts używa guardu przed połączeniem", () => {
  it("checkSeedTarget jest wywołany przed postgres(...)", () => {
    const src = readFileSync(join(process.cwd(), "scripts/seed-test.ts"), "utf8");
    const guardAt = src.indexOf("checkSeedTarget(");
    const connectAt = src.indexOf("postgres(connectionString)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(connectAt).toBeGreaterThan(guardAt);
    expect(src.slice(guardAt, connectAt)).toContain("process.exit(1)");
  });
});

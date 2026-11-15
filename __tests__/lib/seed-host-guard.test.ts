import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import {
  checkSeedClientOptions,
  checkSeedTarget,
  SEED_ALLOWED_HOSTS,
} from "../../scripts/seed-host-guard";

/**
 * Guard hosta seeda testowego. Testujemy tylko czystą funkcję; seed nie jest
 * uruchamiany, a `scripts/seed-test.ts` nie jest importowany (łączy się z bazą).
 */

const SECRET = "S3cr3t-P4ss_xyz";

function reasonOf(result: { ok: true } | { ok: false; reason: string }): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("checkSeedTarget — allowlista", () => {
  it.each([
    ["postgresql://dev_user:dev_password@localhost:5432/pos_dev", "localhost"],
    ["postgres://dev_user:dev_password@127.0.0.1:5432/pos_dev", "127.0.0.1"],
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
    expect([...SEED_ALLOWED_HOSTS].sort()).toEqual(["127.0.0.1", "localhost"]);
  });

  it("odrzuca literał IPv6 (postgres.js 3.4.8 parsuje [::1] jako host \"[\")", () => {
    expect(reasonOf(checkSeedTarget("postgresql://u:p@[::1]:5432/db"))).toContain("IPv6");
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

  it("odrzuca hasło z nieenkodowanym @ (WHATWG i postgres.js mogłyby widzieć różne hosty)", () => {
    expect(reasonOf(checkSeedTarget("postgresql://u:p@localhost@ep-x.neon.tech/db"))).toContain("@");
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

/** postgres.js 3.4.8 bez łączenia: `options` są liczone w konstruktorze, połączenie dopiero przy zapytaniu. */
async function clientOptionsOf(url: string) {
  const sql = postgres(url);
  const { host, path } = sql.options as unknown as { host: string[]; path: string | false };
  await sql.end({ timeout: 0 });
  return { host, path };
}

function fullGuard(url: string, opts: { host: string[]; path: string | false }): boolean {
  return checkSeedTarget(url).ok && checkSeedClientOptions(opts).ok;
}

// B1 z recenzji #56: Leo (6891447141) i Ryan (6891466919).
const B1_URLS = [
  "postgresql://u:p@ep-cool-123.eu-central-1.aws.neon.tech,@localhost/db",
  "postgresql://u@db.example.com,x@localhost:5432/db",
  "postgres://u@evil.example.com,x:p@localhost/db",
  "postgres://u@ep-x.eu-central-1.aws.neon.tech,x:p@localhost/db",
  // warianty zakodowane
  "postgres://u@evil.example.com%2Cx:p@localhost/db",
  "postgres://u@ep-x.eu-central-1.aws.neon.tech%2Cx:p@localhost/db",
  "postgres://u:p@localhost%2Cep-x.neon.tech/db",
];

// Tu postgres.js łączy się z localhost, ale reguła „jeden @, zero przecinków, także po dekodowaniu”
// jest celowo ściślejsza i odrzuca też takie URL-e (np. hasło z %40).
const STRICT_ONLY_URLS = [
  "postgres://u%40ep-x.neon.tech:p@localhost/db",
  "postgres://u:p%40ss@localhost/db",
  "postgres://u:p%2Css@localhost/db",
];

describe("B1: authority z wieloma @ albo przecinkiem", () => {
  it.each(B1_URLS)("etap URL odrzuca %s", (url) => {
    expect(checkSeedTarget(url).ok).toBe(false);
  });

  it.each(B1_URLS)("etap klienta niezależnie odrzuca %s", async (url) => {
    const opts = await clientOptionsOf(url);
    expect(checkSeedClientOptions(opts).ok).toBe(false);
  });

  it.each(STRICT_ONLY_URLS)("etap URL odrzuca także %s (reguła ściślejsza niż parser)", (url) => {
    expect(reasonOf(checkSeedTarget(url))).toContain("@");
  });

  it("odrzuca zepsute kodowanie procentowe w authority", () => {
    expect(checkSeedTarget("postgres://u:p%ZZ@localhost/db").ok).toBe(false);
  });

  it("komunikaty B1 nie zawierają hasła", async () => {
    const url = `postgres://u@evil.example.com,x:${SECRET}@localhost/db`;
    expect(reasonOf(checkSeedTarget(url))).not.toContain(SECRET);
    expect(reasonOf(checkSeedClientOptions(await clientOptionsOf(url)))).not.toContain(SECRET);
  });
});

describe("checkSeedClientOptions — hosty wyliczone przez postgres.js", () => {
  it("przepuszcza wyłącznie hosty z allowlisty", () => {
    expect(checkSeedClientOptions({ host: ["localhost"], path: false })).toEqual({ ok: true, hosts: ["localhost"] });
    expect(checkSeedClientOptions({ host: ["127.0.0.1", "LOCALHOST"] }).ok).toBe(true);
  });

  it("odrzuca, gdy którykolwiek host jest spoza allowlisty", () => {
    expect(reasonOf(checkSeedClientOptions({ host: ["localhost", "db.example.com"] }))).toContain("db.example.com");
  });

  it("odrzuca Neona na dowolnej pozycji listy", () => {
    expect(reasonOf(checkSeedClientOptions({ host: ["localhost", "ep-x.aws.neon.tech"] }))).toContain("Neon");
  });

  it("odrzuca pustą listę hostów i brak hosta", () => {
    expect(checkSeedClientOptions({ host: [] }).ok).toBe(false);
    expect(checkSeedClientOptions({}).ok).toBe(false);
  });

  it("odrzuca gniazdo unix (options.path), także z hostem localhost", () => {
    expect(reasonOf(checkSeedClientOptions({ host: ["localhost"], path: "/tmp/.s.PGSQL.5432" }))).toContain("unix");
  });

  it("maskuje w komunikacie host, który nie wygląda na nazwę hosta", () => {
    const reason = reasonOf(checkSeedClientOptions({ host: [`x:${SECRET}@localhost`] }));
    expect(reason).not.toContain(SECRET);
    expect(reason).toContain("<nieprawidłowy host>");
  });
});

describe("zgodność guardu z postgres.js (test Leo)", () => {
  const CORPUS = [
    "postgresql://dev_user:dev_password@localhost:5432/pos_dev",
    "postgres://dev_user:dev_password@127.0.0.1:5432/pos_dev",
    "postgresql://dev_user:dev_password@LOCALHOST/pos_dev",
    "postgresql://u:p@localhost:5432/db?host=ep-x.neon.tech",
    "postgresql://u:p@localhost/db?sslmode=disable",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@localhost@ep-x.neon.tech/db",
    "postgresql://u:p@localhost:5432,ep-x.neon.tech:5432/db",
    "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb",
    "postgresql://u:p@db.example.com/db",
    "postgres://u:p@%2Ftmp/db",
    ...B1_URLS,
    ...STRICT_ONLY_URLS,
  ];

  it("każdy URL przepuszczony przez guard ma w options.host wyłącznie hosty z allowlisty i brak path", async () => {
    let passed = 0;
    for (const url of CORPUS) {
      const opts = await clientOptionsOf(url);
      if (!fullGuard(url, opts)) continue;
      passed++;
      for (const h of opts.host) {
        expect(SEED_ALLOWED_HOSTS, `${url} -> ${h}`).toContain(h.toLowerCase());
      }
      expect(opts.path, url).toBeFalsy();
    }
    // Korpus ma przypadki dozwolone, więc test nie przechodzi pusto.
    expect(passed).toBeGreaterThanOrEqual(5);
  });

  it("etap URL i etap klienta zgadzają się co do hosta dla URL-i, które etap URL przepuszcza", async () => {
    for (const url of CORPUS) {
      const target = checkSeedTarget(url);
      if (!target.ok) continue;
      const opts = await clientOptionsOf(url);
      expect(opts.host.map((h) => h.toLowerCase()), url).toEqual([target.host]);
    }
  });

  it("URL-e z workflow CI przechodzą oba etapy", async () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/quality-gate.yml"), "utf8");
    const urls = [...workflow.matchAll(/POSTGRES_URL:\s*(\S+)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(fullGuard(url, await clientOptionsOf(url)), url).toBe(true);
    }
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

  it("checkSeedClientOptions sprawdza sql.options, a seed() startuje tylko po pozytywnym wyniku", () => {
    const src = readFileSync(join(process.cwd(), "scripts/seed-test.ts"), "utf8");
    expect(src).toContain("checkSeedClientOptions(sql.options)");
    expect(src).toMatch(/if \(clientTarget\.ok\) \{\s*seed\(\)/);
    expect(src.match(/^seed\(\)/gm)).toBeNull();
  });
});

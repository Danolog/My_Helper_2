import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import {
  checkSeedClientOptions,
  checkSeedServerIdentity,
  checkSeedTarget,
  SEED_ALLOWED_DATABASES,
  SEED_ALLOWED_HOSTS,
  SEED_SERVER_PROBE_SQL,
  type AmbiguousPart,
  type SeedProbeClient,
  type SeedRejectCode,
  verifySeedServerIdentities,
} from "../../scripts/seed-host-guard";

/**
 * Guard hosta seeda testowego. Testujemy tylko czystą funkcję; seed nie jest
 * uruchamiany, a `scripts/seed-test.ts` nie jest importowany (łączy się z bazą).
 */

const SECRET = "S3cr3t-P4ss_xyz";

/** Odmowa z konkretnym kodem; kody są stabilne, treść komunikatu może się zmieniać. */
function expectReject(result: { ok: boolean; code?: string }, code: SeedRejectCode) {
  expect(result).toMatchObject({ ok: false, code });
}

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
      expectReject(checkSeedTarget(`postgresql://u:p@${host}:5432/db`), "host_not_allowed");
    }
  });

  it("allowlista zawiera tylko hosty lokalne", () => {
    expect([...SEED_ALLOWED_HOSTS].sort()).toEqual(["127.0.0.1", "localhost"]);
  });

  it("odrzuca literał IPv6 (postgres.js 3.4.8 parsuje [::1] jako host \"[\")", () => {
    expectReject(checkSeedTarget("postgresql://u:p@[::1]:5432/db"), "ipv6");
  });
});

describe("checkSeedTarget — Neon", () => {
  it.each([
    "postgresql://neondb_owner:pw@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    "postgresql://u:pw@EP-X-POOLER.US-EAST-2.AWS.NEON.TECH/db",
    "postgresql://u:pw@neon.tech/db",
  ])("jawnie odrzuca %s", (url) => {
    expectReject(checkSeedTarget(url), "neon");
  });

  it("odrzuca hasło z nieenkodowanym @ (WHATWG i postgres.js mogłyby widzieć różne hosty)", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost@ep-x.neon.tech/db")).toMatchObject({
      ok: false,
      code: "ambiguous_authority",
      ambiguous: ["multiple_at"],
    });
  });

  it("odrzuca multi-host (postgres.js łączy się po kolei z każdym)", () => {
    expect(checkSeedTarget("postgresql://u:p@localhost:5432,ep-x.neon.tech:5432/db").ok).toBe(false);
  });
});

describe("checkSeedTarget — VERCEL_ENV", () => {
  it.each(["preview", "production", "Production", " preview "])(
    "odrzuca VERCEL_ENV=%j nawet na localhost",
    (vercelEnv) => {
      expectReject(checkSeedTarget("postgresql://u:p@localhost/db", { VERCEL_ENV: vercelEnv }), "vercel_env");
    },
  );
});

describe("checkSeedTarget — URL bez hosta i nieprawidłowy", () => {
  it.each([undefined, "", "   "])("odrzuca brak POSTGRES_URL (%j)", (url) => {
    expectReject(checkSeedTarget(url), "missing_url");
  });

  it("odrzuca URL bez hosta (postgres.js wziąłby PGHOST z env)", () => {
    expectReject(checkSeedTarget("postgresql:///pos_dev"), "no_host");
  });

  it("odrzuca napis, który nie jest URL", () => {
    expectReject(checkSeedTarget("localhost:5432/pos_dev"), "not_a_postgres_url");
  });

  it("odrzuca inny schemat niż postgres", () => {
    expectReject(checkSeedTarget("mysql://u:p@localhost/db"), "bad_scheme");
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

// B1 z recenzji #56: recenzja (6891447141) i audyt bezpieczeństwa (6891466919).
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
const STRICT_ONLY_AMBIGUOUS: AmbiguousPart[][] = [["multiple_at"], ["multiple_at"], ["comma"]];

// N1 z ponownej recenzji z audytu bezpieczeństwa (6891756918): postgres.js tnie authority tylko na `[?/]`, nie na `#`.
const N1_URLS = [
  "postgres://u:p@localhost#@ep-x.neon.tech,x/db",
  "postgres://u:p@localhost%23@ep-x.neon.tech,x/db",
  "postgres://u:p@localhost#frag/db",
  "postgres://u:p@localhost%23x/db",
  "postgres://u:p@localhost#x",
];
const N1_AMBIGUOUS: AmbiguousPart[][] = [
  ["multiple_at", "comma", "hash"],
  ["multiple_at", "comma", "hash"],
  ["hash"],
  ["hash"],
  ["hash"],
];

describe("N1: # w authority", () => {
  // recenzja (6892163799): zamiast `toContain("#")` dokładna lista niejednoznacznych elementów.
  it.each(N1_URLS.map((url, i) => [url, N1_AMBIGUOUS[i]!] as const))(
    "etap URL odrzuca %s z powodu %j",
    (url, parts) => {
      expect(checkSeedTarget(url)).toMatchObject({ ok: false, code: "ambiguous_authority", ambiguous: parts });
    },
  );

  it("sam # w authority jest jedynym powodem odmowy (bez reguły # URL by przeszedł)", () => {
    for (const url of N1_URLS.slice(2)) {
      const result = checkSeedTarget(url);
      expect(result.ok ? [] : result.ambiguous, url).toEqual(["hash"]);
    }
  });

  it("URL z Neonem za # jest odrzucany także przez etap klienta", async () => {
    for (const url of N1_URLS.slice(0, 2)) {
      expect(checkSeedClientOptions(await clientOptionsOf(url)).ok, url).toBe(false);
    }
  });

  it.each([
    "postgres://u:p@localhost/db#frag",
    "postgres://u:p@localhost:5432/db#x@ep-x.neon.tech",
    "postgres://u:p@localhost/db?sslmode=disable#x,y",
  ])("# za ścieżką lub query nie jest w authority, więc %s przechodzi", (url) => {
    expect(checkSeedTarget(url)).toEqual({ ok: true, host: "localhost" });
  });
});

describe("B1: authority z wieloma @ albo przecinkiem", () => {
  it.each(B1_URLS)("etap URL odrzuca %s", (url) => {
    expect(checkSeedTarget(url).ok).toBe(false);
  });

  it.each(B1_URLS)("etap klienta niezależnie odrzuca %s", async (url) => {
    const opts = await clientOptionsOf(url);
    expect(checkSeedClientOptions(opts).ok).toBe(false);
  });

  it.each(STRICT_ONLY_URLS.map((url, i) => [url, STRICT_ONLY_AMBIGUOUS[i]!] as const))(
    "etap URL odrzuca także %s (reguła ściślejsza niż parser): %j",
    (url, parts) => {
      expect(checkSeedTarget(url)).toMatchObject({ ok: false, code: "ambiguous_authority", ambiguous: parts });
    },
  );

  it("odrzuca zepsute kodowanie procentowe w authority", () => {
    expect(checkSeedTarget("postgres://u:p%ZZ@localhost/db")).toMatchObject({
      ok: false,
      code: "ambiguous_authority",
      ambiguous: ["bad_percent_encoding"],
    });
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
    expectReject(checkSeedClientOptions({ host: ["localhost", "ep-x.aws.neon.tech"] }), "neon");
  });

  it("odrzuca pustą listę hostów i brak hosta", () => {
    expect(checkSeedClientOptions({ host: [] }).ok).toBe(false);
    expect(checkSeedClientOptions({}).ok).toBe(false);
  });

  it("odrzuca gniazdo unix (options.path), także z hostem localhost", () => {
    expectReject(checkSeedClientOptions({ host: ["localhost"], path: "/tmp/.s.PGSQL.5432" }), "unix_socket");
  });

  it("maskuje w komunikacie host, który nie wygląda na nazwę hosta", () => {
    const reason = reasonOf(checkSeedClientOptions({ host: [`x:${SECRET}@localhost`] }));
    expect(reason).not.toContain(SECRET);
    expect(reason).toContain("<nieprawidłowy host>");
  });
});

describe("zgodność guardu z postgres.js (test z recenzji)", () => {
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
    ...N1_URLS,
    "postgres://u:p@localhost/db#frag",
    "postgres://u:p@localhost:5432/db#x@ep-x.neon.tech",
    "postgres://u:p@localhost/db?sslmode=disable#x,y",
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

describe("etap 3: checkSeedServerIdentity (tunel localhost → zdalna baza)", () => {
  it("przepuszcza lokalną bazę pos_dev bez ustawień neon.*", () => {
    expect(checkSeedServerIdentity({ database: "pos_dev", neon_settings: 0 })).toEqual({ ok: true, database: "pos_dev" });
  });

  it("allowlista baz to dokładnie baza z docker-compose i CI", () => {
    expect([...SEED_ALLOWED_DATABASES]).toEqual(["pos_dev"]);
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/quality-gate.yml"), "utf8");
    const dbs = [...`${compose}\n${workflow}`.matchAll(/POSTGRES_DB:\s*(\S+)/g)].map((m) => m[1]!);
    expect(dbs.length).toBeGreaterThan(0);
    for (const name of dbs) expect(SEED_ALLOWED_DATABASES).toContain(name);
  });

  it("odrzuca serwer z ustawieniami neon.*, nawet gdy baza nazywa się pos_dev (Neon za tunelem)", () => {
    expectReject(checkSeedServerIdentity({ database: "pos_dev", neon_settings: 7 }), "neon");
  });

  it.each(["neondb", "postgres", "pos_prod", "POS_DEV", ""])("odrzuca bazę %j spoza allowlisty", (database) => {
    expectReject(checkSeedServerIdentity({ database, neon_settings: 0 }), "database_not_allowed");
  });

  it.each([
    ["brak wiersza", undefined],
    ["pusty wiersz", {}],
    ["database nie jest napisem", { database: null, neon_settings: 0 }],
    ["neon_settings jako napis (np. bigint bez rzutowania)", { database: "pos_dev", neon_settings: "0" }],
    ["neon_settings ułamkowe", { database: "pos_dev", neon_settings: 0.5 }],
    ["wiersz nie jest obiektem", "pos_dev"],
  ])("fail closed: %s", (_label, row) => {
    expectReject(checkSeedServerIdentity(row), "server_unknown");
  });

  it("maskuje w komunikacie nazwę bazy, która nie wygląda na identyfikator", () => {
    const reason = reasonOf(checkSeedServerIdentity({ database: `x' ${SECRET}`, neon_settings: 0 }));
    expect(reason).not.toContain(SECRET);
    expect(reason).toContain("<nieprawidłowa nazwa>");
  });

  it("zapytanie sondy jest tylko do odczytu i zwraca dokładnie pola sprawdzane przez guard", () => {
    expect(SEED_SERVER_PROBE_SQL).toMatch(/^select /i);
    expect(SEED_SERVER_PROBE_SQL).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|set)\b/i);
    expect(SEED_SERVER_PROBE_SQL).toContain("current_database() as database");
    expect(SEED_SERVER_PROBE_SQL).toMatch(/::int as neon_settings$/);
  });
});

describe("kontekst komunikatów (harness: INTEGRATION_POSTGRES_URL zamiast seed/POSTGRES_URL)", () => {
  const ctx = { subject: "test integracyjny", varName: "INTEGRATION_POSTGRES_URL" };

  it("etap URL używa nazwy zmiennej i podmiotu z kontekstu", () => {
    expect(reasonOf(checkSeedTarget(undefined, {}, ctx))).toBe("INTEGRATION_POSTGRES_URL jest wymagany");
    const neon = reasonOf(checkSeedTarget("postgresql://u:p@ep-x.neon.tech/db", {}, ctx));
    expect(neon).toMatch(/^test integracyjny jest zablokowany/);
    const vercel = reasonOf(checkSeedTarget("postgresql://u:p@localhost/db", { VERCEL_ENV: "production" }, ctx));
    expect(vercel).toMatch(/^test integracyjny /);
    for (const r of [neon, vercel]) {
      expect(r).not.toMatch(/\bseed\b/);
      expect(r).not.toMatch(/(^|[^_])POSTGRES_URL/);
    }
  });

  it("etap klienta i etap serwera też używają kontekstu", () => {
    expect(reasonOf(checkSeedClientOptions({ host: ["localhost"], path: "/tmp" }, ctx))).toMatch(/^test integracyjny /);
    expect(reasonOf(checkSeedServerIdentity({ database: "neondb", neon_settings: 0 }, ctx))).toMatch(/^test integracyjny /);
  });

  it("bez kontekstu zostają domyślne komunikaty seeda", () => {
    expect(reasonOf(checkSeedTarget(undefined))).toBe("POSTGRES_URL jest wymagany");
    expect(reasonOf(checkSeedServerIdentity({ database: "neondb", neon_settings: 0 }))).toMatch(/^seed /);
  });

  it("pg-harness przekazuje kontekst do wszystkich trzech etapów", () => {
    const src = readFileSync(join(process.cwd(), "__tests__/pg/pg-harness.ts"), "utf8");
    expect(src).toMatch(/checkSeedTarget\([^)]*HARNESS_GUARD_CONTEXT\)/);
    expect(src).toMatch(/checkSeedClientOptions\(client\.options, HARNESS_GUARD_CONTEXT\)/);
    // N1 (audyt bezpieczeństwa): etap 3 obejmuje OBIE pule, nie tylko appClient.
    expect(src).toMatch(/verifySeedServerIdentities\(\[appClient, observer\], HARNESS_GUARD_CONTEXT\)/);
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

  it("seed() sprawdza tożsamość serwera, zanim cokolwiek zapisze", () => {
    const src = readFileSync(join(process.cwd(), "scripts/seed-test.ts"), "utf8");
    const body = src.slice(src.indexOf("async function seed()"));
    const probeAt = body.indexOf("sql.unsafe(SEED_SERVER_PROBE_SQL)");
    const checkAt = body.indexOf("checkSeedServerIdentity(identity)");
    const firstWrite = body.search(/\.(insert|update|delete)\(/);
    expect(probeAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(probeAt);
    expect(firstWrite).toBeGreaterThan(checkAt);
    expect(body.slice(checkAt, firstWrite)).toContain("process.exit(1)");
  });
});

// -------------------------------------------------------
// P3 po #72 (audyt bezpieczeństwa): dwa kody bez asercji kodu + sprzątanie pul przy etapie 3
// -------------------------------------------------------

describe("kody invalid_url i client_no_host", () => {
  it.each([
    `postgresql://u:${SECRET}@localhost:99999/pos_dev`,
    `postgresql://u:${SECRET}@localhost:x/pos_dev`,
    `postgresql://u:${SECRET}@local host/pos_dev`,
  ])("URL przechodzi cięcie authority, ale nie new URL → invalid_url, bez echa hasła (%#)", (url) => {
    const result = checkSeedTarget(url);
    expectReject(result, "invalid_url");
    expect(reasonOf(result)).not.toContain(SECRET);
  });

  it.each([{ host: [] }, { host: undefined }, {}])("klient bez hosta → client_no_host (%j)", (options) => {
    expectReject(checkSeedClientOptions(options), "client_no_host");
  });
});

describe("verifySeedServerIdentities: etap 3 na wszystkich pulach (harness)", () => {
  const LOCAL = { database: "pos_dev", neon_settings: 0 };

  function fakeClient(probe: () => Promise<readonly unknown[]>) {
    const client = {
      unsafe: vi.fn((_sql: string) => probe()),
      end: vi.fn(async (_opts?: { timeout?: number }) => undefined),
    };
    return client satisfies SeedProbeClient;
  }

  it("sonda idzie do KAŻDEJ puli, tym samym zapytaniem; pule zostają otwarte", async () => {
    const app = fakeClient(async () => [LOCAL]);
    const observer = fakeClient(async () => [LOCAL]);
    const result = await verifySeedServerIdentities([app, observer]);
    expect(result).toEqual({ ok: true, databases: ["pos_dev", "pos_dev"] });
    expect(app.unsafe).toHaveBeenCalledWith(SEED_SERVER_PROBE_SQL);
    expect(observer.unsafe).toHaveBeenCalledWith(SEED_SERVER_PROBE_SQL);
    expect(app.end).not.toHaveBeenCalled();
    expect(observer.end).not.toHaveBeenCalled();
  });

  it("druga pula (observer) trafia na Neona → odmowa i OBIE pule zamknięte", async () => {
    const app = fakeClient(async () => [LOCAL]);
    const observer = fakeClient(async () => [{ database: "pos_dev", neon_settings: 3 }]);
    const result = await verifySeedServerIdentities([app, observer]);
    expectReject(result, "neon");
    expect(app.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(observer.end).toHaveBeenCalledWith({ timeout: 0 });
  });

  it("pusta odpowiedź sondy → server_unknown (fail closed) i pule zamknięte", async () => {
    const app = fakeClient(async () => []);
    const observer = fakeClient(async () => [LOCAL]);
    expectReject(await verifySeedServerIdentities([app, observer]), "server_unknown");
    expect(observer.unsafe).not.toHaveBeenCalled();
    expect(app.end).toHaveBeenCalled();
    expect(observer.end).toHaveBeenCalled();
  });

  it("sonda rzuca (timeout połączenia) → OBIE pule zamknięte, oryginalny błąd leci dalej", async () => {
    const boom = new Error("connect_timeout");
    const app = fakeClient(async () => {
      throw boom;
    });
    const observer = fakeClient(async () => [LOCAL]);
    await expect(verifySeedServerIdentities([app, observer])).rejects.toBe(boom);
    expect(app.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(observer.end).toHaveBeenCalledWith({ timeout: 0 });
  });

  it("błąd przy zamykaniu puli nie zasłania przyczyny odmowy", async () => {
    const app = fakeClient(async () => [{ database: "postgres", neon_settings: 0 }]);
    app.end.mockRejectedValueOnce(new Error("end failed"));
    const observer = fakeClient(async () => [LOCAL]);
    expectReject(await verifySeedServerIdentities([app, observer]), "database_not_allowed");
    expect(observer.end).toHaveBeenCalled();
  });

  it("kontekst harnessu trafia do komunikatu odmowy", async () => {
    const app = fakeClient(async () => [{ database: "postgres", neon_settings: 0 }]);
    const result = await verifySeedServerIdentities([app], {
      subject: "test integracyjny",
      varName: "INTEGRATION_POSTGRES_URL",
    });
    expect(reasonOf(result)).toContain("test integracyjny");
  });
});

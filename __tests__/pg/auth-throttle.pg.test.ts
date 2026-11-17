/**
 * Limit prób logowania na PRAWDZIWYM Postgresie (tabela `auth_rate_limit`).
 *
 * Wyjście systemowe `src/lib/server/system/auth-throttle.ts` działa na puli
 * z harnessu (podmiana `@/lib/db`). Logowanie idzie przez prawdziwą instancję
 * Better Auth z fabryką `buildAuthRateLimitOptions("database")`; użytkownicy
 * w adapterze pamięciowym biblioteki (tabele auth w bazie nie są potrzebne),
 * liczniki — w bazie.
 *
 * Każdy test ma własne adresy (198.18.0.0/15) i własne e-maile; wiersze testu
 * są usuwane w afterAll po kluczach (HMAC), które test sam wyliczył.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/auth-throttle.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (tabela `auth_rate_limit`, rola `myhelper_app`).
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/schema";
import {
  checkSeedClientOptions,
  checkSeedTarget,
  verifySeedServerIdentities,
} from "../../scripts/seed-host-guard";

const SECRET = vi.hoisted(() => {
  const s = "it-auth-throttle-secret-0123456789abcdef0123";
  process.env.BETTER_AUTH_SECRET = s;
  return s;
});

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const dbRef = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
// `db-system.ts` kopiuje `db` do stałej przy załadowaniu modułu (`export const dbSystem = db`),
// więc podmiana klienta musi być na `dbSystem` — getter czytany przy każdym zapytaniu wyjścia.
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (dbRef.current) return dbRef.current;
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger }));

import { INTEGRATION_URL, HARNESS_GUARD_CONTEXT } from "./pg-harness";
import { accountThrottleKey, ipThrottleKey } from "@/lib/auth-throttle-keys";
import { buildAuthRateLimitOptions } from "@/lib/auth-rate-limit-options";
import { consumeAuthRateLimit, reserveAccountSignInAttempt } from "@/lib/server/system/auth-throttle";

const suite = h ? describe : describe.skip;

const BASE = "http://localhost:3000";
const PASSWORD = "Poprawne-Haslo-123";
const WRONG = "Zle-Haslo-000";
const RUN = randomUUID().slice(0, 8);
const IN_RULE = { window: 10, max: 3 };

// ── Adresy i klucze testu ────────────────────────────────────────────────────

let ipCounter = Math.floor(Math.random() * 60_000);
/** Kolejny unikalny adres z 198.18.0.0/15 (zakres testowy RFC 2544). */
function nextIp(): string {
  const n = ipCounter++ % 131_072;
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
}
const email = (label: string) => `it-authlimit-${label}-${RUN}-${randomUUID().slice(0, 6)}@example.invalid`;

const trackedKeys: Buffer[] = [];
const SENSITIVE_PATHS = ["/sign-in/email", "/sign-in/social", "/request-password-reset"];
function trackIp(ip: string) {
  for (const p of SENSITIVE_PATHS) trackedKeys.push(ipThrottleKey(`${ip}|${p}`, SECRET));
  return ip;
}
function trackEmail(e: string) {
  trackedKeys.push(accountThrottleKey(e, SECRET));
  return e;
}

type Row = { count: number; window_start: Date; blocked_until: Date | null; updated_at: Date };
async function rowByKey(key: Buffer): Promise<Row | undefined> {
  const rows = (await h!.observer.unsafe(
    "SELECT count, window_start, blocked_until, updated_at FROM auth_rate_limit WHERE key = $1",
    [key],
  )) as unknown as Row[];
  return rows[0];
}
const accountRow = (e: string) => rowByKey(accountThrottleKey(e, SECRET));

// ── Instancja Better Auth z fabryką ──────────────────────────────────────────

function makeAuth(opts: { requireEmailVerification?: boolean } = {}) {
  const rl = buildAuthRateLimitOptions("database");
  const counters = { verify: 0, hash: 0 };
  const captured: { resetToken?: string } = {};
  const auth = betterAuth({
    baseURL: BASE,
    secret: SECRET,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    trustedOrigins: [BASE],
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    rateLimit: rl.rateLimit,
    hooks: rl.hooks,
    socialProviders: { google: { clientId: "it-client-id", clientSecret: "it-client-secret" } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification ?? false,
      password: {
        hash: async (p: string) => {
          counters.hash++;
          return hashPassword(p);
        },
        verify: async (d: { hash: string; password: string }) => {
          counters.verify++;
          return verifyPassword(d);
        },
      },
      sendResetPassword: async ({ token }) => {
        captured.resetToken = token;
      },
      onPasswordReset: rl.onPasswordReset,
    },
  });
  return { auth, counters, captured };
}
type Auth = ReturnType<typeof makeAuth>["auth"];

const post = (auth: Auth, path: string, body: unknown, ip: string) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
/** Próba logowania z NOWEGO adresu (licznik adresu nie wchodzi w drogę). */
const signIn = (auth: Auth, e: string, password: string) =>
  post(auth, "/sign-in/email", { email: e, password }, trackIp(nextIp()));

async function signUp(auth: Auth, e: string, password = PASSWORD) {
  await auth.api.signUpEmail({ body: { email: e, password, name: "IT" } });
}

/** Odpowiedź limitu biblioteki: 4 próby z jednego adresu w oknie → czwarta 429. */
async function libraryRateLimitResponse(auth: Auth): Promise<Response> {
  const ip = trackIp(nextIp());
  const e = trackEmail(email("lib"));
  let last: Response | undefined;
  for (let i = 0; i < 4; i++) last = await post(auth, "/sign-in/email", { email: e, password: WRONG }, ip);
  expect(last!.status).toBe(429);
  return last!;
}

async function shape(res: Response) {
  return {
    status: res.status,
    statusText: res.statusText,
    headerNames: [...res.headers.keys()].sort(),
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  };
}

/** Wszystkie wywołania loggera z całego pliku (sprawdzane w ostatnim teście). */
const allLogCalls: unknown[][] = [];
beforeEach(() => {
  for (const fn of Object.values(logger)) {
    allLogCalls.push(...fn.mock.calls);
    fn.mockClear();
  }
});

suite("auth_rate_limit na prawdziwej bazie", () => {
  afterAll(async () => {
    dbRef.current = undefined;
    if (h) {
      for (const k of trackedKeys) await h.observer.unsafe("DELETE FROM auth_rate_limit WHERE key = $1", [k]);
      await h.end();
    }
  });

  // ── Schemat i uprawnienia ───────────────────────────────────────────────────

  describe("tabela i uprawnienia (W3)", () => {
    it("kolumny dokładnie: key bytea, count integer, window_start/blocked_until/updated_at timestamptz; bez salon_id", async () => {
      const cols = (await h!.observer.unsafe(`
        SELECT column_name::text AS name, data_type::text AS type, is_nullable::text AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'auth_rate_limit'
        ORDER BY column_name`)) as unknown as Array<{ name: string; type: string; nullable: string }>;
      expect(cols).toEqual([
        { name: "blocked_until", type: "timestamp with time zone", nullable: "YES" },
        { name: "count", type: "integer", nullable: "NO" },
        { name: "key", type: "bytea", nullable: "NO" },
        { name: "updated_at", type: "timestamp with time zone", nullable: "NO" },
        { name: "window_start", type: "timestamp with time zone", nullable: "NO" },
      ]);
    });

    it("indeks auth_rate_limit_updated_at_idx na updated_at", async () => {
      const rows = (await h!.observer.unsafe(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'auth_rate_limit_updated_at_idx'",
      )) as unknown as Array<{ indexdef: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.indexdef).toMatch(/\(updated_at\)/);
    });

    /**
     * Warunek wstępny (#193): w bazie testowej obowiązuje reguła domyślnych uprawnień
     * dla nowych tabel w `public` (właściciel = rola połączenia testu) z prawami tabelowymi
     * roli żądań. Bez niej brak uprawnień niczego nie dowodzi o REVOKE w migracji.
     */
    const expectDefaultAclForRequestRole = async () => {
      const rows = (await h!.observer.unsafe(`
        SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) AS privs
        FROM pg_default_acl d, aclexplode(d.defaclacl) a
        WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND d.defaclnamespace = 'public'::regnamespace
          AND d.defaclobjtype = 'r'
          AND a.grantee = 'myhelper_app'::regrole`)) as unknown as Array<{ privs: string[] | null }>;
      expect(
        rows[0]!.privs ?? [],
        "bez reguły domyślnej ten test nie dowodzi REVOKE (#193)",
      ).toEqual(expect.arrayContaining(["DELETE", "INSERT", "SELECT", "UPDATE"]));
    };

    it.each([["SELECT"], ["INSERT"], ["UPDATE"], ["DELETE"], ["TRUNCATE"], ["REFERENCES"], ["TRIGGER"]])(
      "rola żądań myhelper_app nie ma %s (wprost, przez PUBLIC ani członkostwo)",
      async (priv) => {
        await expectDefaultAclForRequestRole();
        const rows = (await h!.observer.unsafe(
          `SELECT has_table_privilege('myhelper_app', 'public.auth_rate_limit', '${priv}') AS ok`,
        )) as unknown as Array<{ ok: boolean }>;
        expect(rows[0]!.ok).toBe(false);
      },
    );

    it("PUBLIC nie ma żadnego prawa do tabeli", async () => {
      const rows = (await h!.observer.unsafe(`
        SELECT count(*)::int AS n FROM pg_class c, aclexplode(c.relacl) a
        WHERE c.oid = 'public.auth_rate_limit'::regclass AND a.grantee = 0`)) as unknown as Array<{ n: number }>;
      expect(rows[0]!.n).toBe(0);
    });
  });

  // ── Licznik adresu ──────────────────────────────────────────────────────────

  describe("licznik adresu (consumeAuthRateLimit)", () => {
    it("W5: 20 równoległych wywołań przy max 3 → dokładnie 3 dozwolone; licznik = 20", async () => {
      const key = `${trackIp(nextIp())}|/sign-in/email`;
      const results = await Promise.all(Array.from({ length: 20 }, () => consumeAuthRateLimit(key, IN_RULE)));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      for (const r of results.filter((x) => !x.allowed)) {
        expect(r.retryAfter).toBeGreaterThanOrEqual(1);
        expect(r.retryAfter).toBeLessThanOrEqual(IN_RULE.window);
      }
      expect((await rowByKey(ipThrottleKey(key, SECRET)))!.count).toBe(20);
    });

    it("wygasłe okno resetuje licznik w tym samym zapytaniu", async () => {
      const key = `${trackIp(nextIp())}|/sign-in/email`;
      for (let i = 0; i < 3; i++) expect((await consumeAuthRateLimit(key, IN_RULE)).allowed).toBe(true);
      expect((await consumeAuthRateLimit(key, IN_RULE)).allowed).toBe(false);
      await h!.observer.unsafe(
        "UPDATE auth_rate_limit SET window_start = now() - interval '11 seconds' WHERE key = $1",
        [ipThrottleKey(key, SECRET)],
      );
      expect(await consumeAuthRateLimit(key, IN_RULE)).toEqual({ allowed: true, retryAfter: null });
      expect((await rowByKey(ipThrottleKey(key, SECRET)))!.count).toBe(1);
    });

    it("w tabeli nie ma adresu IP ani e-maila jawnym tekstem", async () => {
      const ip = trackIp(nextIp());
      const e = trackEmail(email("plain"));
      await consumeAuthRateLimit(`${ip}|/sign-in/email`, IN_RULE);
      await reserveAccountSignInAttempt(e);
      const rows = (await h!.observer.unsafe(
        "SELECT encode(key, 'escape') AS k, length(key) AS len FROM auth_rate_limit WHERE key = $1 OR key = $2",
        [ipThrottleKey(`${ip}|/sign-in/email`, SECRET), accountThrottleKey(e, SECRET)],
      )) as unknown as Array<{ k: string; len: number }>;
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.len).toBe(32);
        expect(r.k).not.toContain(ip);
        expect(r.k).not.toContain(e);
      }
    });

    it("W2: kasowanie wierszy starszych niż 24 h — najwyżej 100 na wywołanie, świeże zostają", async () => {
      const old = (await h!.observer.unsafe(`
        INSERT INTO auth_rate_limit (key, count, window_start, updated_at)
        SELECT decode(md5(random()::text || g::text) || md5(g::text || random()::text), 'hex'), 1,
               now() - interval '25 hours', now() - interval '25 hours'
        FROM generate_series(1, 150) g
        RETURNING key`)) as unknown as Array<{ key: Buffer }>;
      const fresh = (await h!.observer.unsafe(`
        INSERT INTO auth_rate_limit (key, count, window_start, updated_at)
        SELECT decode(md5(random()::text || g::text) || md5(g::text || random()::text), 'hex'), 1,
               now() - interval '23 hours', now() - interval '23 hours'
        FROM generate_series(1, 5) g
        RETURNING key`)) as unknown as Array<{ key: Buffer }>;
      trackedKeys.push(...old.map((r) => r.key), ...fresh.map((r) => r.key));

      const oldTotal = async () =>
        ((await h!.observer.unsafe(
          "SELECT count(*)::int AS n FROM auth_rate_limit WHERE updated_at < now() - interval '24 hours'",
        )) as unknown as Array<{ n: number }>)[0]!.n;
      const before = await oldTotal();
      expect(before).toBeGreaterThanOrEqual(150);

      await consumeAuthRateLimit(`${trackIp(nextIp())}|/sign-in/email`, IN_RULE);
      expect(before - (await oldTotal())).toBe(Math.min(100, before));

      for (let i = 0; i < 10 && (await oldTotal()) > 0; i++) {
        await consumeAuthRateLimit(`${trackIp(nextIp())}|/sign-in/email`, IN_RULE);
      }
      expect(await oldTotal()).toBe(0);
      for (const r of fresh) expect(await rowByKey(r.key)).toBeDefined();
    });

    it("ścieżka niewrażliwa (get-session) nie tworzy wiersza", async () => {
      const ip = nextIp();
      await consumeAuthRateLimit(`${ip}|/get-session`, { window: 10, max: 100 });
      expect(await rowByKey(ipThrottleKey(`${ip}|/get-session`, SECRET))).toBeUndefined();
    });
  });

  // ── Magazyn niedostępny ────────────────────────────────────────────────────

  describe("tabela niedostępna (W6/U3): odmowa, nie 500; odczyt sesji działa", () => {
    it("logowanie → 429, rezerwacja na konto → odmowa 900 s, get-session → 200", async () => {
      // Ten sam serwer, ale search_path bez schematu public: tabela „nie istnieje”.
      const url = INTEGRATION_URL!;
      const target = checkSeedTarget(url, { VERCEL_ENV: process.env.VERCEL_ENV }, HARNESS_GUARD_CONTEXT);
      if (!target.ok) throw new Error(`Odmowa: ${target.reason}`);
      const client = postgres(url, { prepare: false, max: 2, connect_timeout: 5, onnotice: () => {}, connection: { search_path: "pg_catalog" } });
      const clientTarget = checkSeedClientOptions(client.options, HARNESS_GUARD_CONTEXT);
      if (!clientTarget.ok) {
        await client.end({ timeout: 0 });
        throw new Error(`Odmowa: ${clientTarget.reason}`);
      }
      const ip = trackIp(nextIp());
      const ip2 = trackIp(nextIp());
      const e1 = trackEmail(email("down"));
      const e2 = trackEmail(email("down2"));
      const touched = [
        ipThrottleKey(`${ip}|/sign-in/email`, SECRET),
        ipThrottleKey(`${ip2}|/sign-in/email`, SECRET),
        accountThrottleKey(e1, SECRET),
        accountThrottleKey(e2, SECRET),
      ];
      try {
        const server = await verifySeedServerIdentities([client], HARNESS_GUARD_CONTEXT);
        if (!server.ok) throw new Error(`Odmowa: ${server.reason}`);

        // Warunek wstępny 1: przez ten klient tabela naprawdę nie istnieje (błąd bazy 42P01).
        await expect(client.unsafe("SELECT count(*) FROM auth_rate_limit")).rejects.toMatchObject({ code: "42P01" });

        const down = drizzle(client, { schema });
        const downExecute = vi.spyOn(down, "execute");
        const { auth } = makeAuth();
        dbRef.current = down;

        const res = await post(auth, "/sign-in/email", { email: e1, password: WRONG }, ip);
        // Warunek wstępny 2: zapytanie wyjścia poszło przez niedostępny klient i skończyło się błędem.
        expect(downExecute).toHaveBeenCalled();
        // Kod błędu bazy wprost albo w `cause` (drizzle może opakować błąd sterownika).
        const pgCode = (err: unknown) =>
          (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        for (const r of downExecute.mock.results) {
          expect(r.type).toBe("return");
          const err = await Promise.resolve(r.value).then(
            () => null,
            (x: unknown) => x,
          );
          expect(err, "zapytanie przez niedostępny klient nie zwróciło błędu").not.toBeNull();
          expect(pgCode(err)).toBe("42P01");
        }

        expect(res.status).toBe(429);
        // Każdy licznik osobno (429 z logowania daje którykolwiek z nich):
        // licznik adresu → odmowa z retryAfter = okno reguły; licznik konta → odmowa 900 s.
        expect(await consumeAuthRateLimit(`${ip2}|/sign-in/email`, IN_RULE)).toEqual({
          allowed: false,
          retryAfter: IN_RULE.window,
        });
        expect(await reserveAccountSignInAttempt(e2)).toEqual({ allowed: false, retryAfter: 900 });
        const session = await auth.handler(
          new Request(`${BASE}/api/auth/get-session`, { headers: { "x-forwarded-for": trackIp(nextIp()) } }),
        );
        expect(session.status).toBe(200);
        // W4 (przed asercją kształtu logu, żeby czerwień kształtu nie zasłaniała wyniku):
        // żadne wywołanie loggera w tym teście nie zawiera adresu, e-maila ani klucza.
        const allCalls = JSON.stringify(Object.values(logger).flatMap((fn) => fn.mock.calls));
        const forbidden = [ip, ip2, e1, e2, ...touched.flatMap((k) => [k.toString("hex"), k.toString("base64"), JSON.stringify(k)])];
        for (const f of forbidden) expect(allCalls, "log zawiera dane testu").not.toContain(f);
        // Log: sama ścieżka i nazwa klasy błędu. Na tym sterowniku błąd zapytania
        // przychodzi opakowany przez drizzle — w logu jego klasa.
        const errorLogs = logger.error.mock.calls.map((c) => c[1]);
        expect(errorLogs).toContainEqual({ path: "/sign-in/email", error: "DrizzleQueryError" });

        // Nic nie trafiło do działającej tabeli.
        dbRef.current = undefined;
        for (const k of touched) expect(await rowByKey(k)).toBeUndefined();
      } finally {
        dbRef.current = undefined;
        for (const k of touched) await h!.observer.unsafe("DELETE FROM auth_rate_limit WHERE key = $1", [k]);
        await client.end({ timeout: 5 });
      }
    });
  });

  // ── Licznik konta ───────────────────────────────────────────────────────────

  describe("licznik konta (/sign-in/email)", () => {
    it("10 nieudanych prób z 10 adresów → 401; 11. z nowego adresu → 429 identyczne z limitem biblioteki", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("eleven"));
      await signUp(auth, e);
      const statuses: number[] = [];
      let last: Response | undefined;
      for (let i = 0; i < 11; i++) {
        last = await signIn(auth, e, WRONG);
        statuses.push(last.status);
      }
      expect(statuses).toEqual([...Array(10).fill(401), 429]);
      const ours = await shape(last!);
      const lib = await shape(await libraryRateLimitResponse(auth));
      expect(ours).toEqual(lib);
      const retry = Number(last!.headers.get("x-retry-after"));
      expect(retry).toBeGreaterThan(800);
      expect(retry).toBeLessThanOrEqual(900);
    });

    it("w blokadzie poprawne hasło też dostaje 429, a licznik i koniec blokady się nie zmieniają", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("blocked"));
      await signUp(auth, e);
      for (let i = 0; i < 11; i++) await signIn(auth, e, WRONG);
      const before = await accountRow(e);
      const res = await signIn(auth, e, PASSWORD);
      expect(res.status).toBe(429);
      expect(res.headers.get("set-cookie")).toBeNull();
      const after = await accountRow(e);
      expect(after!.count).toBe(before!.count);
      expect(after!.blocked_until!.getTime()).toBe(before!.blocked_until!.getTime());
    });

    it("czas blokady liczony zegarem bazy: zegar aplikacji przesunięty o 16 min w trakcie blokady → nadal 429", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("app-clock"));
      await signUp(auth, e);
      for (let i = 0; i < 11; i++) await signIn(auth, e, WRONG);
      expect((await accountRow(e))!.blocked_until).not.toBeNull();
      const shifted = Date.now() + 16 * 60 * 1000;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => shifted);
      try {
        const res = await signIn(auth, e, PASSWORD);
        expect(res.status).toBe(429);
        const retry = Number(res.headers.get("x-retry-after"));
        expect(retry).toBeGreaterThan(800);
        expect(retry).toBeLessThanOrEqual(900);
        const direct = await reserveAccountSignInAttempt(e);
        expect(direct.allowed).toBe(false);
        expect(direct.retryAfter).toBeGreaterThan(800);
      } finally {
        clock.mockRestore();
      }
    });

    it("konto istniejące i nieistniejące: te same statusy, ta sama chwila 429, ta sama treść i nagłówki", async () => {
      const { auth } = makeAuth();
      const existing = trackEmail(email("exists"));
      const missing = trackEmail(email("missing"));
      await signUp(auth, existing);
      const a: Array<Awaited<ReturnType<typeof shape>>> = [];
      const b: Array<Awaited<ReturnType<typeof shape>>> = [];
      for (let i = 0; i < 12; i++) {
        a.push(await shape(await signIn(auth, existing, WRONG)));
        b.push(await shape(await signIn(auth, missing, WRONG)));
      }
      expect(a.map((x) => x.status)).toEqual([...Array(10).fill(401), 429, 429]);
      expect(b).toEqual(a);
    });

    it("20 równoległych prób jednego istniejącego konta → do sprawdzenia hasła dochodzi dokładnie 10", async () => {
      const { auth, counters } = makeAuth();
      const e = trackEmail(email("burst"));
      await signUp(auth, e);
      counters.verify = 0;
      counters.hash = 0;
      const res = await Promise.all(Array.from({ length: 20 }, () => signIn(auth, e, WRONG)));
      expect(counters.verify + counters.hash).toBe(10);
      expect(res.filter((r) => r.status === 401)).toHaveLength(10);
      expect(res.filter((r) => r.status === 429)).toHaveLength(10);
    });

    it("20 równoległych prób nieistniejącego konta → ten sam wynik: dokładnie 10", async () => {
      const { auth, counters } = makeAuth();
      const e = trackEmail(email("burst-missing"));
      const res = await Promise.all(Array.from({ length: 20 }, () => signIn(auth, e, WRONG)));
      expect(counters.verify + counters.hash).toBe(10);
      expect(res.filter((r) => r.status === 401)).toHaveLength(10);
      expect(res.filter((r) => r.status === 429)).toHaveLength(10);
    });

    it("wielkość liter i spacje w e-mailu liczą się do tego samego konta", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("case"));
      await signIn(auth, e, WRONG);
      await signIn(auth, e.toUpperCase(), WRONG);
      await signIn(auth, `  ${e}  `, WRONG);
      expect((await accountRow(e))!.count).toBe(3);
    });

    it("udane logowanie usuwa licznik; kolejna porażka zaczyna od 1", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("success"));
      await signUp(auth, e);
      for (let i = 0; i < 3; i++) await signIn(auth, e, WRONG);
      expect((await accountRow(e))!.count).toBe(3);
      expect((await signIn(auth, e, PASSWORD)).status).toBe(200);
      expect(await accountRow(e)).toBeUndefined();
      await signIn(auth, e, WRONG);
      expect((await accountRow(e))!.count).toBe(1);
    });

    it("400 (hasło za długie) liczy się i NIE zeruje licznika", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("bad-request"));
      await signUp(auth, e);
      for (let i = 0; i < 3; i++) await signIn(auth, e, WRONG);
      const res = await signIn(auth, e, "x".repeat(300));
      expect(res.status).toBe(400);
      expect((await accountRow(e))!.count).toBe(4);
    });

    it("429 limitu adresu nie zmienia licznika konta", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("ip-limit"));
      const ip = trackIp(nextIp());
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await post(auth, "/sign-in/email", { email: e, password: WRONG }, ip)).status);
      expect(statuses).toEqual([401, 401, 401, 429]);
      expect((await accountRow(e))!.count).toBe(3);
    });

    it("żądanie bez e-maila albo z pustym e-mailem: bez wiersza, licznik istniejącego konta bez zmian", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("empty"));
      trackEmail("");
      await signIn(auth, e, WRONG);
      for (const body of [{ password: WRONG }, { email: "", password: WRONG }, { email: "   ", password: WRONG }]) {
        const res = await post(auth, "/sign-in/email", body, trackIp(nextIp()));
        expect(res.status).toBe(400);
      }
      expect(await accountRow("")).toBeUndefined();
      expect((await accountRow(e))!.count).toBe(1);
    });

    it("kolejność na tej wersji biblioteki: niezweryfikowane konto — złe hasło 401 i licznik +1, dobre hasło 403 i licznik wyzerowany", async () => {
      const { auth } = makeAuth({ requireEmailVerification: true });
      const e = trackEmail(email("unverified"));
      await signUp(auth, e);
      const bad = await signIn(auth, e, WRONG);
      expect(bad.status).toBe(401);
      expect((await accountRow(e))!.count).toBe(1);
      const good = await signIn(auth, e, PASSWORD);
      expect(good.status).toBe(403);
      expect(((await good.json()) as { code?: string }).code).toBe("EMAIL_NOT_VERIFIED");
      expect(await accountRow(e)).toBeUndefined();
    });

    it("reset hasła w czasie blokady → logowanie nowym hasłem przechodzi od razu", async () => {
      const { auth, captured } = makeAuth();
      const e = trackEmail(email("reset"));
      await signUp(auth, e);
      for (let i = 0; i < 11; i++) await signIn(auth, e, WRONG);
      expect((await accountRow(e))!.blocked_until).not.toBeNull();

      const req = await post(auth, "/request-password-reset", { email: e, redirectTo: `${BASE}/reset-password` }, trackIp(nextIp()));
      expect(req.status).toBe(200);
      const reset = await post(auth, "/reset-password", { token: captured.resetToken, newPassword: "Nowe-Haslo-456" }, nextIp());
      expect(reset.status).toBe(200);
      expect(await accountRow(e)).toBeUndefined();
      expect((await signIn(auth, e, "Nowe-Haslo-456")).status).toBe(200);
    });

    it("logowanie Google nie podlega licznikowi konta (także w blokadzie)", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("google"));
      await signUp(auth, e);
      for (let i = 0; i < 11; i++) await signIn(auth, e, WRONG);
      const res = await post(auth, "/sign-in/social", { provider: "google", callbackURL: "/" }, trackIp(nextIp()));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { url?: string }).url).toMatch(/^https:\/\/accounts\.google\.com\//);
    });

    it("blokada mija po czasie: następna próba zaczyna nowe okno (licznik 1, bez blokady)", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("expire"));
      await signUp(auth, e);
      for (let i = 0; i < 11; i++) await signIn(auth, e, WRONG);
      await h!.observer.unsafe(
        "UPDATE auth_rate_limit SET blocked_until = now() - interval '1 second' WHERE key = $1",
        [accountThrottleKey(e, SECRET)],
      );
      expect((await signIn(auth, e, WRONG)).status).toBe(401);
      const row = await accountRow(e);
      expect(row!.count).toBe(1);
      expect(row!.blocked_until).toBeNull();
      expect((await signIn(auth, e, PASSWORD)).status).toBe(200);
    });

    it("okno konta wygasa po 15 min od pierwszej próby: 9 starych porażek nie blokuje", async () => {
      const { auth } = makeAuth();
      const e = trackEmail(email("window"));
      for (let i = 0; i < 9; i++) await signIn(auth, e, WRONG);
      await h!.observer.unsafe(
        "UPDATE auth_rate_limit SET window_start = now() - interval '901 seconds' WHERE key = $1",
        [accountThrottleKey(e, SECRET)],
      );
      for (let i = 0; i < 10; i++) expect((await signIn(auth, e, WRONG)).status).toBe(401);
      expect((await signIn(auth, e, WRONG)).status).toBe(429);
    });
  });

  describe("logi", () => {
    it("żaden log z przebiegów tego pliku nie zawiera adresu testu ani e-maila testu", () => {
      // Co najmniej logi awarii magazynu z testu „tabela niedostępna” — lista nie jest pusta.
      expect(allLogCalls.length).toBeGreaterThan(0);
      for (const c of allLogCalls) {
        const text = JSON.stringify(c);
        expect(text).not.toMatch(/198\.1[89]\./);
        expect(text).not.toMatch(/it-authlimit-/);
      }
    });
  });
});

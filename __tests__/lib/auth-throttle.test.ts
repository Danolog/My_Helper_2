// @vitest-environment node
/**
 * Wyjście systemowe limitu prób logowania (`src/lib/server/system/auth-throttle.ts`),
 * bez bazy: pula systemowa zastąpiona atrapą `execute`, parametry zapytań odczytywane
 * przez dialekt Postgres Drizzle. Zachowanie SQL na prawdziwej bazie (atomowość,
 * okna, retencja, uprawnienia) sprawdzają testy pg.
 *
 * Tu: klucz w zapytaniu (z `@/lib/auth-throttle-keys`), podział ścieżek na licznik
 * w bazie i w pamięci procesu, decyzja z wiersza zwróconego przez bazę, fail-closed
 * i treść logów.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountThrottleKey, ipThrottleKey } from "@/lib/auth-throttle-keys";

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";

const execute = vi.fn();
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: { execute } }));

const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
vi.mock("@/lib/logger", () => ({ logger }));

type Throttle = typeof import("@/lib/server/system/auth-throttle");
let t: Throttle;

const dialect = new PgDialect();
const queryOf = (call: unknown[]) => dialect.sqlToQuery(call[0] as SQL);
const firstBuffer = (call: unknown[]) => queryOf(call).params.find((p): p is Buffer => Buffer.isBuffer(p));

const NOW = new Date("2026-03-02T10:00:00.000Z");
const RULE_IN = { window: 10, max: 3 };
const IP_KEY = "203.0.113.7|/sign-in/email";
const EMAIL = "jan@example.pl";

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  t = await import("@/lib/server/system/auth-throttle");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  execute.mockReset();
  for (const fn of Object.values(logger)) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const at = (offsetSec: number) => new Date(NOW.getTime() + offsetSec * 1000);

/** Wiersz licznika zwracany przez UPSERT … RETURNING. */
const row = (count: number, windowStartAgoSec: number, blockedUntilInSec: number | null = null) => [
  { count, window_start: at(-windowStartAgoSec), blocked_until: blockedUntilInSec === null ? null : at(blockedUntilInSec) },
];

const pgError = (message = "relation does not exist") => Object.assign(new Error(message), { name: "PostgresError" });

describe("klucz w zapytaniu", () => {
  it("licznik adresu: parametr = ipThrottleKey(klucz biblioteki, BETTER_AUTH_SECRET)", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit(IP_KEY, RULE_IN);
    expect(firstBuffer(execute.mock.calls[0]!)!.equals(ipThrottleKey(IP_KEY, SECRET))).toBe(true);
  });

  it("licznik konta: parametr = accountThrottleKey(e-mail, BETTER_AUTH_SECRET), z normalizacją", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.reserveAccountSignInAttempt(" Jan@Example.PL ");
    execute.mockResolvedValue([]);
    await t.clearSignInFailures("JAN@example.pl");
    const expected = accountThrottleKey(EMAIL, SECRET);
    expect(firstBuffer(execute.mock.calls[0]!)!.equals(expected)).toBe(true);
    expect(firstBuffer(execute.mock.calls[1]!)!.equals(expected)).toBe(true);
  });

  it("żaden parametr zapytania nie zawiera adresu IP ani e-maila jawnym tekstem", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit(IP_KEY, RULE_IN);
    await t.reserveAccountSignInAttempt(EMAIL);
    await t.clearSignInFailures(EMAIL);
    for (const call of execute.mock.calls) {
      const { sql, params } = queryOf(call);
      expect(sql).not.toContain("203.0.113.7");
      expect(sql).not.toContain(EMAIL);
      for (const p of params) {
        const text = Buffer.isBuffer(p) ? p.toString("latin1") : String(p);
        expect(text).not.toContain("203.0.113.7");
        expect(text).not.toContain(EMAIL);
      }
    }
  });
});

describe("podział ścieżek: wrażliwe → baza, pozostałe → pamięć procesu", () => {
  it.each([
    ["/sign-in/email"],
    ["/sign-in/social"],
    ["/sign-up/email"],
    ["/change-password"],
    ["/change-email"],
    ["/request-password-reset"],
    ["/send-verification-email"],
    ["/forget-password"],
    ["/email-otp/send-verification-otp"],
    ["/email-otp/request-password-reset"],
  ])("%s → zapytanie do bazy", async (p) => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit(`203.0.113.7|${p}`, RULE_IN);
    expect(execute).toHaveBeenCalled();
  });

  it.each([["/get-session"], ["/sign-out"], ["/list-sessions"], ["/callback/google"], ["/ok"]])(
    "%s → 0 zapytań do bazy",
    async (p) => {
      await t.consumeAuthRateLimit(`203.0.113.7|${p}`, { window: 10, max: 100 });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("ścieżka brana po OSTATNIM „|” (adres IPv6, klucz bez adresu)", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit("2001:0db8:0001:0002:0000:0000:0000:0000|/sign-in/email", RULE_IN);
    const afterIpv6 = execute.mock.calls.length;
    expect(afterIpv6).toBeGreaterThan(0);
    await t.consumeAuthRateLimit("no-trusted-ip|/sign-in/email", RULE_IN);
    expect(execute.mock.calls.length).toBeGreaterThan(afterIpv6);
    execute.mockReset();
    await t.consumeAuthRateLimit("a|/sign-in/email-x|/get-session", { window: 10, max: 100 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("pamięć: max w oknie przechodzi, następna odmowa z retryAfter, po oknie znów dozwolone", async () => {
    const key = "198.51.100.9|/get-session";
    const rule = { window: 10, max: 3 };
    for (let i = 0; i < 3; i++) expect((await t.consumeAuthRateLimit(key, rule)).allowed).toBe(true);
    const denied = await t.consumeAuthRateLimit(key, rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfter).toBeLessThanOrEqual(10);
    vi.setSystemTime(at(10));
    expect((await t.consumeAuthRateLimit(key, rule)).allowed).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("pamięć: różne adresy liczą się osobno", async () => {
    const rule = { window: 10, max: 1 };
    expect((await t.consumeAuthRateLimit("198.51.100.10|/get-session", rule)).allowed).toBe(true);
    expect((await t.consumeAuthRateLimit("198.51.100.11|/get-session", rule)).allowed).toBe(true);
    expect((await t.consumeAuthRateLimit("198.51.100.10|/get-session", rule)).allowed).toBe(false);
  });
});

describe("licznik adresu: decyzja z wiersza bazy", () => {
  it("count ≤ max → dozwolone, retryAfter null", async () => {
    execute.mockResolvedValue(row(3, 2));
    expect(await t.consumeAuthRateLimit(IP_KEY, RULE_IN)).toEqual({ allowed: true, retryAfter: null });
  });

  it("count > max → odmowa, retryAfter = koniec okna − teraz (w górę)", async () => {
    execute.mockResolvedValue([{ count: 4, window_start: at(-3.5), blocked_until: null }]);
    expect(await t.consumeAuthRateLimit(IP_KEY, RULE_IN)).toEqual({ allowed: false, retryAfter: 7 });
  });

  it("odmowa na granicy okna → retryAfter co najmniej 1", async () => {
    execute.mockResolvedValue(row(4, 10));
    expect(await t.consumeAuthRateLimit(IP_KEY, RULE_IN)).toEqual({ allowed: false, retryAfter: 1 });
  });

  it("pierwsze zapytanie: INSERT … ON CONFLICT … DO UPDATE … RETURNING, okno jako parametr", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit(IP_KEY, RULE_IN);
    const { sql, params } = queryOf(execute.mock.calls[0]!);
    expect(sql).toMatch(/insert into\s+"?auth_rate_limit"?/i);
    expect(sql).toMatch(/on conflict/i);
    expect(sql).toMatch(/do update/i);
    expect(sql).toMatch(/returning/i);
    expect(sql).not.toMatch(/delete/i);
    expect(params).toContain(10);
  });

  it("drugie zapytanie w tym samym wywołaniu: ograniczone kasowanie (> 24 h, LIMIT 100, SKIP LOCKED)", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.consumeAuthRateLimit(IP_KEY, RULE_IN);
    expect(execute).toHaveBeenCalledTimes(2);
    const del = queryOf(execute.mock.calls[1]!).sql;
    expect(del).toMatch(/delete from\s+"?auth_rate_limit"?/i);
    expect(del).toMatch(/limit 100/i);
    expect(del).toMatch(/skip locked/i);
    expect(del).toMatch(/24 hours/i);
  });

  it("błąd kasowania nie zmienia wyniku limitu", async () => {
    execute.mockResolvedValueOnce(row(2, 1)).mockRejectedValueOnce(pgError());
    expect(await t.consumeAuthRateLimit(IP_KEY, RULE_IN)).toEqual({ allowed: true, retryAfter: null });
  });
});

describe("licznik konta: rezerwacja próby", () => {
  it("jedno zapytanie: UPSERT z oknem 900 s, progiem 10 i blokadą 15 min w parametrach albo treści", async () => {
    execute.mockResolvedValue(row(1, 0));
    await t.reserveAccountSignInAttempt(EMAIL);
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = queryOf(execute.mock.calls[0]!);
    expect(sql).toMatch(/insert into\s+"?auth_rate_limit"?/i);
    expect(sql).toMatch(/on conflict/i);
    expect(sql).toMatch(/blocked_until/i);
    expect(sql).toMatch(/returning/i);
    const text = `${sql} ${params.join(" ")}`;
    expect(text).toMatch(/\b900\b/);
    expect(text).toMatch(/\b10\b/);
  });

  it("brak blokady w wierszu → przepuszczenie", async () => {
    execute.mockResolvedValue(row(10, 60));
    expect(await t.reserveAccountSignInAttempt(EMAIL)).toEqual({ allowed: true, retryAfter: null });
  });

  it("blocked_until w przyszłości → odmowa, retryAfter do końca blokady (w górę)", async () => {
    execute.mockResolvedValue([{ count: 11, window_start: at(-60), blocked_until: at(125.5) }]);
    expect(await t.reserveAccountSignInAttempt(EMAIL)).toEqual({ allowed: false, retryAfter: 126 });
  });

  it("blocked_until w przeszłości → przepuszczenie (nowe okno liczy baza)", async () => {
    execute.mockResolvedValue([{ count: 1, window_start: NOW, blocked_until: at(-1) }]);
    expect(await t.reserveAccountSignInAttempt(EMAIL)).toEqual({ allowed: true, retryAfter: null });
  });

  it("clearSignInFailures: jedno DELETE po kluczu konta", async () => {
    execute.mockResolvedValue([]);
    expect(await t.clearSignInFailures(EMAIL)).toEqual({ cleared: true });
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql } = queryOf(execute.mock.calls[0]!);
    expect(sql).toMatch(/delete from\s+"?auth_rate_limit"?/i);
    expect(sql).not.toMatch(/\blimit\s+\d/i);
  });
});

describe("fail-closed", () => {
  it("consumeAuthRateLimit: błąd zapisu → odmowa, retryAfter = okno reguły", async () => {
    execute.mockRejectedValue(pgError());
    expect(await t.consumeAuthRateLimit(IP_KEY, { window: 60, max: 3 })).toEqual({ allowed: false, retryAfter: 60 });
  });

  it("reserveAccountSignInAttempt: błąd → odmowa, retryAfter 900", async () => {
    execute.mockRejectedValue(pgError());
    expect(await t.reserveAccountSignInAttempt(EMAIL)).toEqual({ allowed: false, retryAfter: 900 });
  });

  it("reserveAccountSignInAttempt: pusty wynik zapytania → odmowa (nie przepuszczenie)", async () => {
    execute.mockResolvedValue([]);
    expect((await t.reserveAccountSignInAttempt(EMAIL)).allowed).toBe(false);
  });

  it("clearSignInFailures: błąd → { cleared: false } bez wyjątku", async () => {
    execute.mockRejectedValue(pgError());
    expect(await t.clearSignInFailures(EMAIL)).toEqual({ cleared: false });
  });
});

describe("logi: bez adresu IP, adresu e-mail i klucza", () => {
  it("błędy magazynu logują wyłącznie ścieżkę i nazwę błędu", async () => {
    execute.mockRejectedValue(pgError(`203.0.113.7 ${EMAIL}`));
    await t.consumeAuthRateLimit(IP_KEY, RULE_IN);
    await t.reserveAccountSignInAttempt(EMAIL);
    await t.clearSignInFailures(EMAIL);

    const calls = Object.values(logger).flatMap((fn) => fn.mock.calls);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const keys = [ipThrottleKey(IP_KEY, SECRET), accountThrottleKey(EMAIL, SECRET)];
    const forbidden = ["203.0.113.7", EMAIL, ...keys.flatMap((k) => [k.toString("hex"), k.toString("base64")])];
    for (const call of calls) {
      const text = JSON.stringify(call, (_k, v) =>
        Buffer.isBuffer(v) ? v.toString("hex") : v instanceof Error ? `${v.name}:${v.message}` : v,
      );
      for (const f of forbidden) expect(text).not.toContain(f);
    }
    const consumeLog = logger.error.mock.calls.find((c) => String(c[0]) === "auth rate limit store error");
    expect(consumeLog).toBeDefined();
    expect(consumeLog![1]).toEqual({ path: "/sign-in/email", error: "PostgresError" });
  });
});

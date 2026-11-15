/**
 * Zgodność klucza limitu: Better Auth (`getIP` z @better-auth/core 1.7.25,
 * z naszą konfiguracją `advanced.ipAddress`) i nasz `getClientIp` muszą dać
 * TEN SAM adres dla tych samych nagłówków — w obu gałęziach VERCEL.
 *
 * Importujemy prawdziwy kod Better Auth (nie mock), rozwiązany względem
 * zainstalowanego pakietu better-auth (pnpm nie wystawia @better-auth/core
 * jako zależności najwyższego poziomu).
 *
 * Świadome rozbieżności (poza tym testem, opisane w PR):
 *  - pusta lista + łańcuch XFF poza Vercelem: Better Auth → null (wspólny
 *    kubełek), my → prawy wpis (zatwierdzone przez Ethana: błąd w stronę
 *    „surowiej", nie „obejście");
 *
 * Normalizacja klucza jest wspólna: IPv6 → /64 w pełnym zapisie,
 * ::ffff:a.b.c.d → a.b.c.d (normalizeClientIp). Test „normalizacja” niżej
 * pilnuje zgodności zapisu dla tych samych adresów w obu gałęziach VERCEL.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { getClientIp } from "@/lib/rate-limit";
import { getAuthIpAddressOptions } from "@/lib/trusted-proxies";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type GetIP = (req: Request, options: { advanced?: { ipAddress?: unknown } }) => string | null;
let betterAuthGetIP: GetIP;

beforeAll(async () => {
  const req = createRequire(import.meta.url);
  const betterAuthEntry = req.resolve("better-auth");
  const ipModulePath = createRequire(betterAuthEntry).resolve("@better-auth/core/utils/ip");
  const mod = (await import(/* @vite-ignore */ pathToFileURL(ipModulePath).href)) as {
    getIP: GetIP;
  };
  betterAuthGetIP = mod.getIP;
});

const originalTrusted = process.env.TRUSTED_PROXIES;
const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalTrusted === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = originalTrusted;
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

/** Better Auth w testach wraca do 127.0.0.1, gdy nie ustali IP; my do "unknown". */
function betterAuthKey(headers: Record<string, string>): string | null {
  const ip = betterAuthGetIP(new Request("http://localhost/api/auth/sign-in/email", { headers }), {
    advanced: { ipAddress: getAuthIpAddressOptions() },
  });
  return ip === "127.0.0.1" ? null : ip;
}

function ourKey(headers: Record<string, string>): string | null {
  const ip = getClientIp(new Request("http://localhost/api/appointments", { headers }));
  return ip === "unknown" ? null : ip;
}

const LB = "34.120.10.5";

type Case = [string, Record<string, string>];

const nonVercelCases: Case[] = [
  ["pojedynczy XFF", { "x-forwarded-for": "203.0.113.50" }],
  ["XFF + podrobiony x-real-ip (ignorowany przez obie)", { "x-forwarded-for": "203.0.113.50", "x-real-ip": "6.6.6.6" }],
  ["sam x-real-ip (obie: brak IP)", { "x-real-ip": "6.6.6.6" }],
  ["brak nagłówków", {}],
  ["łańcuch przez LB z listy", { "x-forwarded-for": `6.6.6.6, 203.0.113.50, ${LB}` }],
  ["sam LB (cały łańcuch zaufany → brak IP)", { "x-forwarded-for": LB }],
  // N1 (Ryan, #55): niepoprawny hop → brak IP w obu warstwach.
  ["niepoprawny pojedynczy XFF", { "x-forwarded-for": "garbage" }],
  ["XFF z portem", { "x-forwarded-for": "203.0.113.50:1234" }],
  ["IPv6 ze strefą", { "x-forwarded-for": "fe80::1%eth0" }],
  ["IPv6 w nawiasach", { "x-forwarded-for": "[2001:db8::1]" }],
  ["IPv4 z zerem wiodącym", { "x-forwarded-for": "203.0.113.050" }],
  ["niepoprawny hop między klientem a LB", { "x-forwarded-for": `203.0.113.50, unknown, ${LB}` }],
  ["niepoprawny hop na miejscu LB", { "x-forwarded-for": `203.0.113.50, ${LB}, not-an-ip` }],
  ["niepoprawny wpis na lewo od klienta (bez wpływu)", { "x-forwarded-for": `garbage, 203.0.113.50, ${LB}` }],
];

const vercelCases: Case[] = [
  ["x-real-ip + łańcuch XFF 'a, b'", { "x-forwarded-for": "6.6.6.6, 76.76.21.1", "x-real-ip": "203.0.113.50" }],
  ["x-real-ip = pojedynczy XFF (dzisiejszy Vercel)", { "x-forwarded-for": "203.0.113.50", "x-real-ip": "203.0.113.50" }],
  ["tylko x-real-ip", { "x-real-ip": "203.0.113.50" }],
  ["brak x-real-ip, pojedynczy XFF (zapas)", { "x-forwarded-for": "203.0.113.50" }],
  ["niepoprawny x-real-ip → XFF", { "x-forwarded-for": "203.0.113.50", "x-real-ip": "not-an-ip" }],
  ["niepoprawny x-real-ip i niepoprawny XFF", { "x-forwarded-for": "garbage", "x-real-ip": "not-an-ip" }],
  ["brak x-real-ip, XFF z portem", { "x-forwarded-for": "203.0.113.50:1234" }],
  ["brak nagłówków", {}],
];

describe("parzystość klucza: Better Auth vs getClientIp", () => {
  describe("poza Vercelem, TRUSTED_PROXIES = LB", () => {
    it.each(nonVercelCases)("%s", (_name, headers) => {
      delete process.env.VERCEL;
      process.env.TRUSTED_PROXIES = LB;
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  describe("poza Vercelem, pusta lista (jednowartościowe nagłówki)", () => {
    it.each(nonVercelCases.filter(([, h]) => !(h["x-forwarded-for"] ?? "").includes(",")))(
      "%s",
      (_name, headers) => {
        delete process.env.VERCEL;
        delete process.env.TRUSTED_PROXIES;
        expect(ourKey(headers)).toBe(betterAuthKey(headers));
      }
    );
  });

  describe("na Vercelu (VERCEL=1), pusta lista", () => {
    it.each(vercelCases)("%s", (_name, headers) => {
      process.env.VERCEL = "1";
      delete process.env.TRUSTED_PROXIES;
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  describe("na Vercelu (VERCEL=1), TRUSTED_PROXIES = LB", () => {
    it.each(vercelCases)("%s", (_name, headers) => {
      process.env.VERCEL = "1";
      process.env.TRUSTED_PROXIES = LB;
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  // Ten sam wybrany hop musi dać ten sam zapis klucza (IPv6 /64, IPv4-mapped).
  const normalizationAddrs = [
    "2001:db8:1:2:3:4:5:6",
    "2001:DB8:1:2::ABCD",
    "2001:db8::1",
    "2600:1901:0:1234:aaaa:bbbb:cccc:dddd",
    "fe80::1",
    "::1",
    "::ffff:203.0.113.50",
    "::FFFF:203.0.113.50",
    "203.0.113.50",
  ];

  describe("normalizacja: poza Vercelem, TRUSTED_PROXIES = LB, klient za LB", () => {
    it.each(normalizationAddrs)("%s", (addr) => {
      delete process.env.VERCEL;
      process.env.TRUSTED_PROXIES = LB;
      const headers = { "x-forwarded-for": `6.6.6.6, ${addr}, ${LB}` };
      expect(ourKey(headers)).not.toBeNull();
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  describe("normalizacja: poza Vercelem, pusta lista, pojedynczy XFF", () => {
    it.each(normalizationAddrs)("%s", (addr) => {
      delete process.env.VERCEL;
      delete process.env.TRUSTED_PROXIES;
      const headers = { "x-forwarded-for": addr };
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  describe("normalizacja: VERCEL=1, x-real-ip", () => {
    it.each(normalizationAddrs)("%s", (addr) => {
      process.env.VERCEL = "1";
      delete process.env.TRUSTED_PROXIES;
      const headers = { "x-forwarded-for": "6.6.6.6, 76.76.21.1", "x-real-ip": addr };
      expect(ourKey(headers)).toBe(betterAuthKey(headers));
    });
  });

  it("sanity: przypadki faktycznie dają adres (test nie przechodzi na samych null)", () => {
    process.env.VERCEL = "1";
    delete process.env.TRUSTED_PROXIES;
    expect(ourKey(vercelCases[0]![1])).toBe("203.0.113.50");
    expect(betterAuthKey(vercelCases[0]![1])).toBe("203.0.113.50");
  });
});

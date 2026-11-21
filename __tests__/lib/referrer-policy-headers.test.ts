// @vitest-environment node
/**
 * Strażnik nagłówka Referrer-Policy (next.config.ts, headers()).
 *
 * Strony i adresy z tokenem jednorazowym Better Auth w adresie mają
 * `Referrer-Policy: no-referrer`, żeby adres z tokenem nie trafiał w nagłówku
 * Referer do kolejnych żądań (zasoby strony, RSC, wysyłka formularza), a stąd
 * do logów żądań platformy. Pozostałe strony zostają przy
 * `strict-origin-when-cross-origin` (regresja).
 *
 * Wyliczenie nagłówków odpowiedzi odtwarza regułę Next.js: każdy pasujący
 * wpis headers() ustawia swoje nagłówki po kolei, więc przy tym samym kluczu
 * wygrywa ostatni pasujący wpis. Dopasowanie ścieżki tym samym matcherem co
 * Next.js (path-to-regexp z next/dist).
 *
 * Kształt wpisów (bezwarunkowe, poza komentarzem blokowym, po "/(.*)") jest
 * kontraktem z infra/gcp/logging.sh — tamten strażnik:
 * __tests__/lib/logging-config.test.ts.
 */
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

const NO_REFERRER_SOURCES = ["/reset-password", "/api/auth/reset-password/:token", "/api/auth/verify-email"];

type HeaderRoute = Awaited<ReturnType<NonNullable<typeof nextConfig.headers>>>[number];

async function routes(): Promise<HeaderRoute[]> {
  expect(nextConfig.headers).toBeTypeOf("function");
  return nextConfig.headers!();
}

/** Nagłówki odpowiedzi dla ścieżki: wszystkie pasujące wpisy po kolei, ostatni wygrywa. */
async function responseHeaders(pathname: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const route of await routes()) {
    const match = getPathMatch(route.source, { strict: true, removeUnnamedParams: true });
    if (match(pathname) === false) continue;
    for (const h of route.headers) out.set(h.key.toLowerCase(), h.value);
  }
  return out;
}

describe("Referrer-Policy: no-referrer na adresach z tokenem", () => {
  it.each([
    "/reset-password",
    "/api/auth/reset-password/AbCdEf123456",
    "/api/auth/verify-email",
  ])("%s → no-referrer", async (pathname) => {
    expect((await responseHeaders(pathname)).get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    "/",
    "/login",
    "/forgot-password",
    "/register",
    "/dashboard",
    "/salons",
    "/api/health",
    "/api/auth/reset-password",
    "/api/auth/sign-in/email",
    "/api/auth/get-session",
    "/reset-password-help",
    "/x/reset-password",
  ])("%s → strict-origin-when-cross-origin (bez zmian)", async (pathname) => {
    expect((await responseHeaders(pathname)).get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("pozostałe nagłówki bezpieczeństwa na stronie resetu zostają", async () => {
    const h = await responseHeaders("/reset-password");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("wpisy no-referrer: bezwarunkowe, tylko Referrer-Policy, po ostatnim wpisie \"/(.*)\"", async () => {
    const list = await routes();
    const catchAll = list.map((r) => r.source).lastIndexOf("/(.*)");
    expect(catchAll).toBeGreaterThanOrEqual(0);
    for (const source of NO_REFERRER_SOURCES) {
      const entries = list.filter((r) => r.source === source);
      expect(entries, source).toHaveLength(1);
      const entry = entries[0]!;
      expect(list.indexOf(entry), source).toBeGreaterThan(catchAll);
      expect(entry.has, source).toBeUndefined();
      expect(entry.missing, source).toBeUndefined();
      expect(entry.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });

  it("w headers() brak komentarza blokowego (sprawdzenie w logging.sh pomija tylko linie //)", () => {
    const src = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    const start = src.indexOf("async headers()");
    expect(start).toBeGreaterThan(0);
    expect(src.slice(start)).not.toContain("/*");
  });
});

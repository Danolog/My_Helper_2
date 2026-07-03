/**
 * CSRF — signed double-submit cookie (HMAC-SHA256 przez Web Crypto,
 * kompatybilne z Edge Runtime). Kontrakt:
 *   - generateSecret: 32 losowe bajty hex (64 znaki), unikalne,
 *   - hmacSign: deterministyczny hex HMAC(appSecret, data),
 *   - validateCsrfToken: true tylko dla tokenu podpisanego tym samym
 *     sekretem app dla tego samego csrf-secret,
 *   - fail-closed: w produkcji brak BETTER_AUTH_SECRET => wyjatek
 *     (zadnego podpisywania znanym dev-sekretem).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  generateSecret,
  hmacSign,
  validateCsrfToken,
  CSRF_SECRET_COOKIE,
  CSRF_TOKEN_COOKIE,
  CSRF_HEADER,
} from "@/lib/csrf";

const HEX_64 = /^[0-9a-f]{64}$/;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateSecret", () => {
  it("zwraca 64-znakowy hex (32 losowe bajty)", () => {
    expect(generateSecret()).toMatch(HEX_64);
  });

  it("kolejne sekrety sa rozne (losowosc)", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("hmacSign", () => {
  it("zwraca 64-znakowy hex (HMAC-SHA256) i jest deterministyczny", async () => {
    const sig1 = await hmacSign("dane-do-podpisu");
    const sig2 = await hmacSign("dane-do-podpisu");
    expect(sig1).toMatch(HEX_64);
    expect(sig1).toBe(sig2);
  });

  it("rozne dane daja rozne podpisy", async () => {
    expect(await hmacSign("secret-a")).not.toBe(await hmacSign("secret-b"));
  });

  it("podpis zalezy od sekretu aplikacji (BETTER_AUTH_SECRET)", async () => {
    const defaultSig = await hmacSign("payload");
    vi.stubEnv("BETTER_AUTH_SECRET", "inny-sekret-aplikacji-32-znaki-ok!!");
    const otherSig = await hmacSign("payload");
    expect(otherSig).toMatch(HEX_64);
    expect(otherSig).not.toBe(defaultSig);
  });

  it("fail-closed: w produkcji brak BETTER_AUTH_SECRET => wyjatek", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(hmacSign("payload")).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("validateCsrfToken", () => {
  it("akceptuje token wygenerowany z tego samego sekretu (happy path)", async () => {
    const secret = generateSecret();
    const token = await hmacSign(secret);
    await expect(validateCsrfToken(secret, token)).resolves.toBe(true);
  });

  it("odrzuca przerobiony token", async () => {
    const secret = generateSecret();
    const token = await hmacSign(secret);
    const tampered = (token[0] === "0" ? "1" : "0") + token.slice(1);
    await expect(validateCsrfToken(secret, tampered)).resolves.toBe(false);
  });

  it("odrzuca token podpisany dla INNEGO csrf-secret (podmiana cookie)", async () => {
    const tokenForOther = await hmacSign(generateSecret());
    await expect(validateCsrfToken(generateSecret(), tokenForOther)).resolves.toBe(false);
  });

  it("odrzuca token podpisany innym sekretem aplikacji", async () => {
    const secret = generateSecret();
    vi.stubEnv("BETTER_AUTH_SECRET", "sekret-atakujacego-32-znaki-dlugi!!");
    const forgedToken = await hmacSign(secret);
    vi.unstubAllEnvs();
    await expect(validateCsrfToken(secret, forgedToken)).resolves.toBe(false);
  });
});

describe("stale nazwy cookies/headera (kontrakt middleware <-> klient)", () => {
  it("eksportuje spodziewane nazwy", () => {
    expect(CSRF_SECRET_COOKIE).toBe("csrf-secret");
    expect(CSRF_TOKEN_COOKIE).toBe("csrf-token");
    expect(CSRF_HEADER).toBe("x-csrf-token");
  });
});

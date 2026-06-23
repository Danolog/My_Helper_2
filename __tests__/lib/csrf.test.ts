/**
 * Testy jednostkowe ochrony CSRF (src/lib/csrf.ts) — wzorzec signed
 * double-submit cookie na Web Crypto (Edge Runtime).
 *
 * Pokrycie: determinizm i format HMAC, losowość sekretu, walidacja tokenu
 * (happy path + odrzucenie podrobionego/pustego tokenu).
 */
import { describe, it, expect } from "vitest";
import {
  CSRF_SECRET_COOKIE,
  CSRF_TOKEN_COOKIE,
  CSRF_HEADER,
  hmacSign,
  generateSecret,
  validateCsrfToken,
} from "@/lib/csrf";

describe("csrf — stałe", () => {
  it("eksportuje nazwy cookie/header zgodne z wzorcem double-submit", () => {
    expect(CSRF_SECRET_COOKIE).toBe("csrf-secret");
    expect(CSRF_TOKEN_COOKIE).toBe("csrf-token");
    expect(CSRF_HEADER).toBe("x-csrf-token");
  });
});

describe("csrf.hmacSign", () => {
  it("zwraca 64 znaki hex (SHA-256 = 32 bajty)", async () => {
    const sig = await hmacSign("abc");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("jest deterministyczny dla tego samego wejścia", async () => {
    expect(await hmacSign("abc")).toBe(await hmacSign("abc"));
  });

  it("daje różne podpisy dla różnych wejść", async () => {
    expect(await hmacSign("abc")).not.toBe(await hmacSign("abd"));
  });
});

describe("csrf.generateSecret", () => {
  it("zwraca 64 znaki hex (32 losowe bajty)", () => {
    expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("daje różne wartości przy kolejnych wywołaniach", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("csrf.validateCsrfToken", () => {
  it("akceptuje token będący HMAC z sekretu (happy path)", async () => {
    const secret = generateSecret();
    const token = await hmacSign(secret);
    await expect(validateCsrfToken(secret, token)).resolves.toBe(true);
  });

  it("odrzuca podrobiony token", async () => {
    const secret = generateSecret();
    await expect(validateCsrfToken(secret, "deadbeef")).resolves.toBe(false);
  });

  it("odrzuca pusty token", async () => {
    const secret = generateSecret();
    await expect(validateCsrfToken(secret, "")).resolves.toBe(false);
  });
});

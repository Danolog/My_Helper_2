// @vitest-environment node
/**
 * Klucze liczników limitu prób logowania (`src/lib/auth-throttle-keys.ts`).
 *
 * Czyste funkcje: HMAC-SHA256 z kluczem wyprowadzonym HKDF z sekretu, osobne
 * etykiety dla licznika adresu i licznika konta. W bazie nigdy nie ma adresu IP
 * ani adresu e-mail jawnym tekstem. Normalizacja e-maila: obcięcie białych znaków
 * i małe litery — nic więcej (kropki i plusy zostają, bo dla wielu dostawców
 * poczty to różne skrzynki).
 */
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { accountThrottleKey, ipThrottleKey, normalizeSignInEmail } from "@/lib/auth-throttle-keys";

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";
const OTHER_SECRET = "other-secret-for-auth-throttle-0123456789abcd";

const derive = (secret: string, label: string) => Buffer.from(hkdfSync("sha256", secret, "", label, 32));
const hmac = (k: Buffer, v: string) => createHmac("sha256", k).update(v).digest();
const K_IP = derive(SECRET, "myhelper/auth-throttle/ip/v1");
const K_ACCT = derive(SECRET, "myhelper/auth-throttle/account/v1");

describe("normalizeSignInEmail", () => {
  it.each([
    ["Jan@Example.PL", "jan@example.pl"],
    ["  jan@example.pl  ", "jan@example.pl"],
    ["\tJAN@EXAMPLE.PL\n", "jan@example.pl"],
    ["jan@example.pl", "jan@example.pl"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeSignInEmail(input)).toBe(expected);
  });

  it.each([["j.a.n@example.pl"], ["jan+tag@example.pl"], ["jan@sub.example.pl"]])(
    "%j zostaje bez zmian (bez usuwania kropek i plusów)",
    (input) => {
      expect(normalizeSignInEmail(input)).toBe(input);
    },
  );
});

describe("ipThrottleKey", () => {
  it("HMAC(k_ip, klucz biblioteki), 32 bajty", () => {
    const key = ipThrottleKey("203.0.113.7|/sign-in/email", SECRET);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    expect(key.equals(hmac(K_IP, "203.0.113.7|/sign-in/email"))).toBe(true);
  });

  it("deterministyczny", () => {
    expect(ipThrottleKey("203.0.113.7|/sign-in/email", SECRET).equals(ipThrottleKey("203.0.113.7|/sign-in/email", SECRET))).toBe(true);
  });

  it("różne adresy i różne ścieżki → różne klucze", () => {
    const a = ipThrottleKey("203.0.113.7|/sign-in/email", SECRET);
    expect(a.equals(ipThrottleKey("203.0.113.8|/sign-in/email", SECRET))).toBe(false);
    expect(a.equals(ipThrottleKey("203.0.113.7|/sign-up/email", SECRET))).toBe(false);
  });

  it("inny sekret → inny klucz", () => {
    expect(ipThrottleKey("203.0.113.7|/sign-in/email", SECRET).equals(ipThrottleKey("203.0.113.7|/sign-in/email", OTHER_SECRET))).toBe(false);
  });
});

describe("accountThrottleKey", () => {
  it("HMAC(k_acct, znormalizowany e-mail), 32 bajty", () => {
    const key = accountThrottleKey("jan@example.pl", SECRET);
    expect(key.length).toBe(32);
    expect(key.equals(hmac(K_ACCT, "jan@example.pl"))).toBe(true);
  });

  it("normalizuje sam: warianty wielkości liter i spacji → ten sam klucz", () => {
    const expected = hmac(K_ACCT, "jan@example.pl");
    for (const v of ["Jan@Example.PL", " jan@example.pl ", "JAN@EXAMPLE.PL\n"]) {
      expect(accountThrottleKey(v, SECRET).equals(expected)).toBe(true);
    }
  });

  it("inny sekret → inny klucz", () => {
    expect(accountThrottleKey("jan@example.pl", SECRET).equals(accountThrottleKey("jan@example.pl", OTHER_SECRET))).toBe(false);
  });
});

describe("rozdział liczników i brak jawnych danych", () => {
  it("ta sama wartość wejściowa daje różne klucze dla adresu i dla konta", () => {
    const same = "jan@example.pl";
    expect(ipThrottleKey(same, SECRET).equals(accountThrottleKey(same, SECRET))).toBe(false);
  });

  it("klucz nie zawiera wejścia w żadnym kodowaniu i nie jest zwykłym skrótem SHA-256", () => {
    const inputs: Array<[Buffer, string]> = [
      [ipThrottleKey("203.0.113.7|/sign-in/email", SECRET), "203.0.113.7"],
      [accountThrottleKey("jan@example.pl", SECRET), "jan@example.pl"],
    ];
    for (const [key, plain] of inputs) {
      for (const enc of ["latin1", "utf8", "hex", "base64"] as const) {
        expect(key.toString(enc)).not.toContain(plain);
      }
    }
    expect(accountThrottleKey("jan@example.pl", SECRET).equals(createHash("sha256").update("jan@example.pl").digest())).toBe(false);
  });
});

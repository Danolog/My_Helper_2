/**
 * N3 (#65/#67): wspólny helper bezpiecznych metadanych błędu — używa go logger,
 * a T3b (catch webhooka Stripe) może wołać bezpośrednio.
 */
import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import {
  INVALID_JSON_MESSAGE,
  redactQueryParamsText,
  toErrorIdentity,
  toSafeErrorMeta,
  type SafeErrorMeta,
} from "@/lib/safe-error";

const PII = ["Anna Nowak", "+48123456789", "anna@test.pl"];

function drizzleError() {
  return new DrizzleQueryError(
    'insert into "appointments" ("guest_name", "guest_phone", "guest_email") values ($1, $2, $3)',
    PII,
    Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Key (guest_email)=(anna@test.pl) already exists.",
    })
  );
}

describe("toSafeErrorMeta", () => {
  it("DrizzleQueryError z parametrami → w metadanych żadnej wartości parametru (message, stack, detail)", () => {
    const meta = toSafeErrorMeta(drizzleError()) as SafeErrorMeta;
    const serialized = JSON.stringify(meta);

    for (const value of PII) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("detail");
    expect(meta.message).toBe(
      'Failed query: insert into "appointments" ("guest_name", "guest_phone", "guest_email") values ($1, $2, $3)\nparams: [redacted]'
    );
    expect(meta.stack).toMatch(/params: \[redacted\]\n\s+at /);
    expect(meta.causeCode).toBe("23505");
  });

  it("parametr zawierający '\\n    at ' nie skraca wycięcia", () => {
    const meta = toSafeErrorMeta(new DrizzleQueryError("select $1", ["x\n    at sekret@poczta.pl"]));
    expect(JSON.stringify(meta)).not.toContain("sekret@poczta.pl");
  });

  it("napis z parametrami (np. zalogowane error.message) też jest redagowany", () => {
    const text = drizzleError().message;
    expect(toSafeErrorMeta(text)).toBe(redactQueryParamsText(text));
    expect(String(toSafeErrorMeta(text))).not.toContain("anna@test.pl");
  });

  it("zwykły Error i inne wartości — bez zmian", () => {
    const err = new Error("boom");
    expect(toSafeErrorMeta(err)).toEqual({ message: "boom", name: "Error", stack: err.stack });
    expect(toSafeErrorMeta("zwykły napis")).toBe("zwykły napis");
    expect(toSafeErrorMeta(42)).toBe(42);
    expect(toSafeErrorMeta(null)).toBeNull();
  });
});

describe("toSafeErrorMeta — błąd parsowania JSON", () => {
  // Zły znak tuż przed wartością: wycinek wejścia w treści błędu obejmuje
  // znaki następujące po nim. Fragment = część wartości widoczna w wycinku.
  const CASES = [
    { raw: 'x"anna@test.pl"', fragment: "anna@test" },
    { raw: 'x"+48123456789"', fragment: "4812345" },
  ];
  const RAW = CASES[0]!.raw;

  function jsonParseError(text: string): SyntaxError {
    try {
      JSON.parse(text);
    } catch (e) {
      return e as SyntaxError;
    }
    throw new Error("JSON.parse nie rzucił");
  }

  it("SyntaxError z JSON.parse z telefonem i e-mailem → w metadanych ani wartości, ani wycinka wejścia", () => {
    for (const { raw, fragment } of CASES) {
      const err = jsonParseError(raw);
      // Warunek wstępny: treść oryginału niesie wycinek wejścia.
      expect(err.message).toContain(fragment);
      expect(err.message).toContain("is not valid JSON");

      const meta = toSafeErrorMeta(err) as SafeErrorMeta;
      const serialized = JSON.stringify(meta);
      expect(serialized, raw).not.toContain(fragment);
      expect(serialized).not.toContain("is not valid JSON");
      expect(serialized).not.toContain("Unexpected token");
      expect(meta.message).toBe(INVALID_JSON_MESSAGE);
      expect(meta.name).toBe("SyntaxError");
    }
  });

  it("stack zaczyna się od bezpiecznej linii i zachowuje ramki", () => {
    const meta = toSafeErrorMeta(jsonParseError(RAW)) as SafeErrorMeta;
    expect(meta.stack?.startsWith(`SyntaxError: ${INVALID_JSON_MESSAGE}\n`)).toBe(true);
    expect(meta.stack).toMatch(/\n\s+at /);
  });

  it("'Unexpected end of JSON input' (treść zawiera JSON) → stały tekst", () => {
    const err = jsonParseError('{"phone":');
    expect(err.message).toContain("JSON");
    expect((toSafeErrorMeta(err) as SafeErrorMeta).message).toBe(INVALID_JSON_MESSAGE);
  });

  it("napis error.message błędu parsowania → stały tekst", () => {
    const text = jsonParseError(RAW).message;
    expect(toSafeErrorMeta(text)).toBe(INVALID_JSON_MESSAGE);
  });

  it("napis z treścią błędu parsowania i dopiskiem po niej → stały tekst", () => {
    const text = `${jsonParseError(RAW).message} (POST /api/appointments)`;
    // Warunek wstępny: napis niesie wycinek wejścia i nie kończy się frazą błędu.
    expect(text).toContain("anna@test");
    expect(text.endsWith("is not valid JSON")).toBe(false);
    expect(toSafeErrorMeta(text)).toBe(INVALID_JSON_MESSAGE);
  });

  it("SyntaxError bez JSON w treści i zwykły Error → bez zmian", () => {
    const syntax = new SyntaxError("x");
    expect(toSafeErrorMeta(syntax)).toEqual({ message: "x", name: "SyntaxError", stack: syntax.stack });
    const plain = new Error("Invalid JSON body");
    expect(toSafeErrorMeta(plain)).toEqual({ message: "Invalid JSON body", name: "Error", stack: plain.stack });
    expect(toSafeErrorMeta("JSON w środku napisu")).toBe("JSON w środku napisu");
  });
});

describe("toErrorIdentity (N1, Ryan #62 — catch webhooka Stripe)", () => {
  it("DrizzleQueryError → tylko nazwa i kod z cause; bez message, stack, zapytania i parametrów", () => {
    const identity = toErrorIdentity(drizzleError());
    expect(identity).toEqual({ errorName: "DrizzleQueryError", errorCode: "23505" });
    const serialized = JSON.stringify(identity);
    for (const value of PII) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("insert");
  });

  it("kod własny błędu (Postgres) i typ błędu Stripe", () => {
    expect(toErrorIdentity(Object.assign(new Error("deadlock"), { code: "40P01" }))).toEqual({
      errorName: "Error",
      errorCode: "40P01",
    });
    expect(toErrorIdentity(Object.assign(new Error("x"), { type: "StripeAPIError" }))).toEqual({
      errorName: "Error",
      errorCode: "StripeAPIError",
    });
  });

  it("błąd bez kodu i wartość nie-Error → bez treści", () => {
    expect(toErrorIdentity(new TypeError("Anna Nowak"))).toEqual({ errorName: "TypeError" });
    expect(toErrorIdentity("+48123456789")).toEqual({ errorName: "string" });
    expect(toErrorIdentity(null)).toEqual({ errorName: "object" });
  });
});

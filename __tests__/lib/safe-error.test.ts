/**
 * N3 (#65/#67): wspólny helper bezpiecznych metadanych błędu — używa go logger,
 * a T3b (catch webhooka Stripe) może wołać bezpośrednio.
 */
import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { redactQueryParamsText, toSafeErrorMeta, type SafeErrorMeta } from "@/lib/safe-error";

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

/**
 * `isRetryableLockFailure`: 55P03 i 40P01 bezpośrednio i w `cause`,
 * inne kody i wartości nie-błędowe → false.
 */
import { describe, expect, it } from "vitest";
import { isRetryableLockFailure } from "@/lib/pg-lock-failure";

const withCode = (code: unknown) => Object.assign(new Error("db"), { code });

describe("isRetryableLockFailure", () => {
  it.each(["55P03", "40P01"])("%s na samym błędzie → true", (code) => {
    expect(isRetryableLockFailure(withCode(code))).toBe(true);
  });

  it.each(["55P03", "40P01"])("%s opakowany w cause (jak Drizzle) → true", (code) => {
    expect(isRetryableLockFailure(new Error("Failed query", { cause: withCode(code) }))).toBe(true);
  });

  it("dwa poziomy opakowania → true", () => {
    const inner = new Error("Failed query", { cause: withCode("40P01") });
    expect(isRetryableLockFailure(new Error("outer", { cause: inner }))).toBe(true);
  });

  it("kod głębiej niż limit opakowań → false", () => {
    let e: Error = withCode("55P03");
    for (let i = 0; i < 3; i++) e = new Error(`w${i}`, { cause: e });
    expect(isRetryableLockFailure(e)).toBe(false);
  });

  it.each([
    ["23503 (klucz obcy)", withCode("23503")],
    ["23505 opakowany", new Error("x", { cause: withCode("23505") })],
    ["kod liczbowy", withCode(55)],
    ["zwykły Error", new Error("boom")],
    ["null", null],
    ["undefined", undefined],
    ["napis", "55P03"],
  ])("%s → false", (_label, value) => {
    expect(isRetryableLockFailure(value)).toBe(false);
  });
});

/**
 * `isRetryableLockFailure`: 55P03 i 40P01; `isRetryableWriteConflict`: 40P01
 * i 40001 — bezpośrednio i w `cause`; inne kody i wartości nie-błędowe → false.
 */
import { describe, expect, it } from "vitest";
import { isRetryableLockFailure, isRetryableWriteConflict } from "@/lib/pg-lock-failure";

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

  it("40001 (serializacja) to nie błąd blokady → false", () => {
    expect(isRetryableLockFailure(withCode("40001"))).toBe(false);
  });
});

describe("isRetryableWriteConflict", () => {
  it.each(["40P01", "40001"])("%s na samym błędzie → true", (code) => {
    expect(isRetryableWriteConflict(withCode(code))).toBe(true);
  });

  it.each(["40P01", "40001"])("%s opakowany w cause (jak Drizzle) → true", (code) => {
    expect(isRetryableWriteConflict(new Error("Failed query", { cause: withCode(code) }))).toBe(true);
  });

  it("kod głębiej niż limit opakowań → false", () => {
    let e: Error = withCode("40001");
    for (let i = 0; i < 3; i++) e = new Error(`w${i}`, { cause: e });
    expect(isRetryableWriteConflict(e)).toBe(false);
  });

  it.each([
    ["55P03 (lock_timeout)", withCode("55P03")],
    ["23505 opakowany", new Error("x", { cause: withCode("23505") })],
    ["zwykły Error", new Error("boom")],
    ["null", null],
    ["napis", "40P01"],
  ])("%s → false", (_label, value) => {
    expect(isRetryableWriteConflict(value)).toBe(false);
  });
});

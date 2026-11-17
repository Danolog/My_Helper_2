// @vitest-environment node
/**
 * Wspólny pomocnik serializacji logów w testach (`__tests__/helpers/logged-text.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import { LOG_LEVELS, loggedText, serializeForAssertion } from "../helpers/logged-text";

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("serializeForAssertion — obiekty błędów", () => {
  it("sam JSON.stringify gubi treść błędu — dlatego pomocnik", () => {
    expect(JSON.stringify({ error: new Error("tajne-1") })).not.toContain("tajne-1");
  });

  it("treść i nazwa błędu, także klasy pochodnej", () => {
    class ProviderError extends Error {
      override name = "ProviderError";
    }
    const text = serializeForAssertion({ error: new ProviderError("tajne-2") });
    expect(text).toContain("tajne-2");
    expect(text).toContain("ProviderError");
  });

  it("łańcuch cause, także przyczyna niebędąca błędem", () => {
    const err = new Error("góra", { cause: new Error("środek", { cause: { phone: "tajne-3" } }) });
    const text = serializeForAssertion([err]);
    expect(text).toContain("środek");
    expect(text).toContain("tajne-3");
  });

  it("własne pola błędu (code, type, raw)", () => {
    const err = Object.assign(new Error("x"), { code: "tajne-4", raw: { email: "tajne-5" } });
    const text = serializeForAssertion(err);
    expect(text).toContain("tajne-4");
    expect(text).toContain("tajne-5");
  });

  it("błąd w tablicy, w zagnieżdżonym obiekcie i w AggregateError", () => {
    const text = serializeForAssertion({
      a: [new Error("tajne-6")],
      b: { c: { d: new Error("tajne-7") } },
      e: new AggregateError([new Error("tajne-8")], "zbiorczy"),
    });
    for (const s of ["tajne-6", "tajne-7", "tajne-8"]) expect(text).toContain(s);
  });

  it("Map, Set i BigInt widoczne; cykl nie rzuca", () => {
    const cyclic: Record<string, unknown> = { v: "tajne-9" };
    cyclic.self = cyclic;
    const text = serializeForAssertion({
      m: new Map([["k", "tajne-10"]]),
      s: new Set(["tajne-11"]),
      n: BigInt("12345678901234567890"),
      cyclic,
    });
    for (const s of ["tajne-9", "tajne-10", "tajne-11", "12345678901234567890"]) expect(text).toContain(s);
  });

  it("ten sam błąd w dwóch wywołaniach: treść widoczna (pierwsze wystąpienie w całości)", () => {
    const err = new Error("tajne-12");
    expect(serializeForAssertion([[err], [err]])).toContain("tajne-12");
  });
});

describe("loggedText — wszystkie poziomy", () => {
  it.each(LOG_LEVELS)("log poziomu %s jest widoczny", (level) => {
    const logger = fakeLogger();
    logger[level]("komunikat", { error: new Error(`tajne-${level}`) });
    expect(loggedText(logger)).toContain(`tajne-${level}`);
  });

  it("kolejne wywołania, nie tylko pierwsze", () => {
    const logger = fakeLogger();
    logger.error("pierwszy", { ok: 1 });
    logger.error("drugi", { error: new Error("tajne-13") });
    expect(loggedText(logger)).toContain("tajne-13");
  });

  it("pole loggera spoza LOG_LEVELS, jeśli jest atrapą, też jest zbierane", () => {
    const logger = { ...fakeLogger(), fatal: vi.fn() };
    logger.fatal("x", { v: "tajne-14" });
    expect(loggedText(logger)).toContain("tajne-14");
  });

  it("poziom bez atrapy vi.fn → wyjątek, nie pusta asercja", () => {
    const logger = { ...fakeLogger(), warn: (..._args: unknown[]) => undefined };
    expect(() => loggedText(logger)).toThrow(/logger\.warn nie jest atrapą/);
  });

  it("pusty log → napis bez wywołań, asercja „nie zawiera” przechodzi", () => {
    expect(loggedText(fakeLogger())).not.toContain("tajne");
  });
});

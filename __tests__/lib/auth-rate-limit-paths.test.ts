// @vitest-environment node
/**
 * Zamknięta lista ścieżek liczonych przez licznik adresu w pamięci procesu
 * (`src/lib/auth-rate-limit-paths.ts`). Każda inna ścieżka idzie do licznika w bazie
 * (podział sprawdza `__tests__/lib/auth-throttle.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { MEMORY_COUNTED_PATHS, isMemoryCountedPath } from "@/lib/auth-rate-limit-paths";

describe("lista ścieżek liczonych w pamięci procesu", () => {
  it("dokładnie pięć pozycji: get-session, sign-out, list-sessions, callback/*, ok", () => {
    expect(MEMORY_COUNTED_PATHS).toEqual(["/get-session", "/sign-out", "/list-sessions", "/callback/*", "/ok"]);
  });

  it("lista jest zamrożona", () => {
    expect(Object.isFrozen(MEMORY_COUNTED_PATHS)).toBe(true);
  });

  it.each([["/get-session"], ["/sign-out"], ["/list-sessions"], ["/callback/google"], ["/ok"]])("%s → pamięć", (p) => {
    expect(isMemoryCountedPath(p)).toBe(true);
  });

  it.each([
    ["/sign-in/email"],
    ["/sign-up/email"],
    ["/verify-email"],
    ["/reset-password"],
    ["/callback"],
    ["/callback/"],
    ["/get-session-x"],
    ["/get-session/x"],
    ["/oki"],
    ["/ok/x"],
    [""],
    ["/"],
  ])("%j → nie pamięć", (p) => {
    expect(isMemoryCountedPath(p)).toBe(false);
  });
});

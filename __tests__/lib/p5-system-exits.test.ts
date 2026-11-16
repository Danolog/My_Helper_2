/**
 * #193 P5a/b — kontrakt przeniesienia tras systemowych do `src/lib/server/system/**`.
 *
 * Czerwone do PR partii: trasy z listy P5 importują dziś `@/lib/db` wprost.
 * Po P5a/b żadna z nich nie dotyka puli: crony i powiadomienia wołają wyjścia
 * z rejestru `@/lib/server/system` (moduły notifications / deposits-cleanup;
 * plans / seed wracają w P5b). `reminders/appointment` — forSalon albo system/ (do ustalenia
 * w PR na podstawie źródła salonId), więc tu tylko zakaz `@/lib/db`.
 * `register-subscription` to P5c (po P1c) — poza tym plikiem.
 *
 * Test czyta źródła (bez importu tras), więc nie zależy od mocków puli.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Import modułu (statyczny, typu albo dynamiczny) — bez komentarzy. */
const importsFrom = (code: string, spec: string) =>
  new RegExp(`(?:from|import)\\s*\\(?\\s*["']${spec.replace(/[/.]/g, "\\$&")}["']`).test(
    code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
  );

/** Trasa P5a/b → moduł docelowy w `system/` (§1 zlecenia P5). */
const SYSTEM_ROUTES: Array<[string, string]> = [
  ["src/app/api/cron/push-reminders/route.ts", "notifications"],
  ["src/app/api/cron/push-reminders-24h/route.ts", "notifications"],
  ["src/app/api/cron/sms-reminders/route.ts", "notifications"],
  ["src/app/api/cron/cleanup-pending-deposits/route.ts", "deposits-cleanup"],
  ["src/app/api/notifications/birthday/route.ts", "notifications"],
  ["src/app/api/notifications/low-stock/route.ts", "notifications"],
  ["src/app/api/notifications/we-miss-you/route.ts", "notifications"],
];
const SALON_OR_SYSTEM_ROUTES = ["src/app/api/reminders/appointment/route.ts"];

describe("#193 P5a/b: trasy systemowe bez puli żądań", () => {
  it.each([...SYSTEM_ROUTES.map(([f]) => f), ...SALON_OR_SYSTEM_ROUTES])("%s nie importuje @/lib/db", (file) => {
    expect(importsFrom(src(file), "@/lib/db")).toBe(false);
  });

  it.each(SYSTEM_ROUTES)("%s woła wyjście z rejestru @/lib/server/system (moduł %s)", (file) => {
    const code = src(file);
    expect(importsFrom(code, "@/lib/server/system")).toBe(true);
    // Moduły system/* wychodzą tylko przez rejestr (R-Z1) — nie wprost.
    expect(code).not.toMatch(/["']@\/lib\/server\/system\/[^"']+["']/);
  });

  it.each([...new Set(SYSTEM_ROUTES.map(([, m]) => m))])("moduł system/%s.ts istnieje", (mod) => {
    expect(existsSync(path.join(ROOT, "src/lib/server/system", `${mod}.ts`))).toBe(true);
  });

  it("crony P5 nie trafiają do system/cron.ts (decyzja Ethana: cron.ts zostaje z jedną funkcją z P0b)", () => {
    const exported = [...src("src/lib/server/system/cron.ts").matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported).toEqual(["cleanupExpiredTemporaryAccess"]);
  });
});

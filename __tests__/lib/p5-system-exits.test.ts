/**
 * #193 P5a-2 — kontrakt przeniesienia tras P5a-2 poza pulę żądań.
 *
 * Czerwone do PR partii: trasy z listy importują dziś `@/lib/db` wprost.
 * Po P5a-2 żadna z nich nie dotyka puli:
 * - crony i `reminders/appointment` (salonId tam jest opcjonalnym filtrem
 *   wołającego crona) wołają wyjścia z rejestru `@/lib/server/system`
 *   (moduły notifications / deposits-cleanup);
 * - `notifications/{birthday,low-stock,we-miss-you}` działają na jednym salonie
 *   z obowiązkowym `salonId`, więc idą przez `forSalon(salonId)` (decyzja CTO
 *   przed kodem P5a-2), bez wyjść `system/`.
 * `register-subscription` to P5c (po P1c), a plans/seed to P5b — poza tym plikiem.
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

/** Trasa P5a-2 → moduł docelowy w `system/`. */
const SYSTEM_ROUTES: Array<[string, string]> = [
  ["src/app/api/cron/push-reminders/route.ts", "notifications"],
  ["src/app/api/cron/push-reminders-24h/route.ts", "notifications"],
  ["src/app/api/cron/sms-reminders/route.ts", "notifications"],
  ["src/app/api/cron/cleanup-pending-deposits/route.ts", "deposits-cleanup"],
  ["src/app/api/reminders/appointment/route.ts", "notifications"],
];
/** Trasy jednego salonu → `forSalon(salonId)`. */
const SALON_ROUTES = [
  "src/app/api/notifications/birthday/route.ts",
  "src/app/api/notifications/low-stock/route.ts",
  "src/app/api/notifications/we-miss-you/route.ts",
];

describe("#193 P5a-2: trasy bez puli żądań", () => {
  it.each([...SYSTEM_ROUTES.map(([f]) => f), ...SALON_ROUTES])("%s nie importuje @/lib/db", (file) => {
    expect(importsFrom(src(file), "@/lib/db")).toBe(false);
  });

  it.each(SYSTEM_ROUTES)("%s woła wyjście z rejestru @/lib/server/system (moduł %s)", (file) => {
    const code = src(file);
    expect(importsFrom(code, "@/lib/server/system")).toBe(true);
    // Moduły system/* wychodzą tylko przez rejestr (R-Z1) — nie wprost.
    expect(code).not.toMatch(/["']@\/lib\/server\/system\/[^"']+["']/);
  });

  it.each(SALON_ROUTES)("%s idzie przez forSalon, bez wyjść system/", (file) => {
    const code = src(file);
    expect(importsFrom(code, "@/lib/server/repository")).toBe(true);
    expect(code).toMatch(/\bforSalon\(/);
    expect(importsFrom(code, "@/lib/server/system")).toBe(false);
    expect(code).not.toMatch(/["']@\/lib\/server\/system\/[^"']+["']/);
  });

  it("reminders/appointment: podgląd jednego salonu (GET) przez forSalon, wybór i oznaczenie (POST) przez wyjścia", () => {
    const code = src("src/app/api/reminders/appointment/route.ts");
    expect(importsFrom(code, "@/lib/server/repository")).toBe(true);
    expect(code).toMatch(/\bforSalon\(salonId\)\.raw\(/);
    expect(code).not.toMatch(/\bgetAppointmentReminderPreview\b/);
  });

  it.each([...new Set(SYSTEM_ROUTES.map(([, m]) => m))])("moduł system/%s.ts istnieje", (mod) => {
    expect(existsSync(path.join(ROOT, "src/lib/server/system", `${mod}.ts`))).toBe(true);
  });

  it("crony P5 nie trafiają do system/cron.ts (decyzja CTO: cron.ts zostaje z jedną funkcją z P0b)", () => {
    const exported = [...src("src/lib/server/system/cron.ts").matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
    expect(exported).toEqual(["cleanupExpiredTemporaryAccess"]);
  });
});

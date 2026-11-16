// @vitest-environment node
/**
 * Teardown E2E (#175), część bez bazy: skąd bierze adres i kiedy odmawia.
 * Usuwanie po znaczniku na prawdziwym Postgresie: `__tests__/pg/e2e-cleanup.pg.test.ts`.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_MARKER,
  e2eGuestName,
  e2eNotes,
  guardedCleanupClient,
  resolveCleanupUrl,
} from "../../tests/e2e-cleanup";

const LOCAL = "postgresql://u:p@localhost:5432/pos_dev";

describe("resolveCleanupUrl", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function envFile(content: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-cleanup-"));
    dirs.push(dir);
    const file = path.join(dir, ".env.local");
    fs.writeFileSync(file, content);
    return file;
  }

  it("POSTGRES_URL z procesu ma pierwszeństwo przed .env.local (CI)", () => {
    const file = envFile('POSTGRES_URL="postgresql://u:p@other:5432/x"\n');
    expect(resolveCleanupUrl({ POSTGRES_URL: ` ${LOCAL} ` }, file)).toBe(LOCAL);
  });

  it("bez zmiennej w procesie bierze POSTGRES_URL z .env.local i NIE ustawia reszty pliku w process.env", () => {
    const key = `E2E_CLEANUP_PROBE_${process.pid}`;
    const file = envFile(`STRIPE_SECRET_KEY=sk_test_x\n${key}=1\nPOSTGRES_URL="${LOCAL}"\n`);
    const env: NodeJS.ProcessEnv = {};
    expect(resolveCleanupUrl(env, file)).toBe(LOCAL);
    expect(env).toEqual({});
    expect(process.env[key]).toBeUndefined();
  });

  it("brak zmiennej i brak pliku → undefined (strażnik odmówi: missing_url)", () => {
    expect(resolveCleanupUrl({}, path.join(os.tmpdir(), "nie-ma-takiego-pliku.env"))).toBeUndefined();
  });

  it("plik bez POSTGRES_URL → undefined", () => {
    expect(resolveCleanupUrl({}, envFile("OTHER=1\n"))).toBeUndefined();
  });
});

describe("guardedCleanupClient: odmowa przed połączeniem", () => {
  it.each([
    ["brak adresu", undefined, {}, /POSTGRES_URL jest wymagany/],
    ["Neon", "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb", {}, /Neon/],
    ["host spoza allowlisty", "postgresql://u:p@db.example.com:5432/pos_dev", {}, /spoza allowlisty/],
    ["VERCEL_ENV=production", LOCAL, { VERCEL_ENV: "production" }, /VERCEL_ENV=production/],
    ["VERCEL_ENV=preview", LOCAL, { VERCEL_ENV: "preview" }, /VERCEL_ENV=preview/],
    ["niejednoznaczny host (dwie małpy)", "postgresql://u:p@evil.example@localhost/pos_dev", {}, /małpy/],
  ] as const)("%s", async (_name, url, env, reason) => {
    const p = guardedCleanupClient(url, env as NodeJS.ProcessEnv);
    await expect(p).rejects.toThrow(/^\[e2e-cleanup\] Odmowa: /);
    await expect(p).rejects.toThrow(reason);
  });

  it("komunikat odmowy nie zawiera hasła ani użytkownika", async () => {
    const err = await guardedCleanupClient("postgresql://tajny_user:tajne_haslo@db.example.com/pos_dev", {}).catch(
      (e: Error) => e
    );
    expect(String(err)).not.toMatch(/tajny_user|tajne_haslo/);
  });
});

describe("znacznik", () => {
  it("notes i imię gościa zaczynają się od [E2E]", () => {
    expect(E2E_MARKER).toBe("[E2E]");
    expect(e2eNotes("x")).toBe("[E2E] x");
    expect(e2eGuestName("Gosc")).toBe("[E2E] Gosc");
    // Imię gościa musi przejść walidację (min. 2 znaki po trim, src/lib/api-validation.ts).
    expect(e2eGuestName("Gosc").trim().length).toBeGreaterThanOrEqual(2);
  });
});

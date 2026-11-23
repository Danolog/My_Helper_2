/**
 * Retencja tabel auth (`cleanupExpiredAuthRecords`, system/auth-retention.ts)
 * na PRAWDZIWYM Postgresie.
 *
 * Dowody:
 * a) wygasła sesja i wygasły rekord weryfikacji znikają, aktywne zostają;
 * b) granica: wiersz z `expires_at` RÓWNYM chwili przebiegu zostaje (warunek
 *    ostry `<`, tak samo jak `expiresAt < new Date()` w Better Auth — sesja,
 *    którą Better Auth jeszcze wpuszcza, nie jest kasowana); wiersz o 1 ms
 *    starszy znika. Chwila przebiegu jest zamrożona (`vi.setSystemTime`, fałszywy
 *    jest wyłącznie `Date`, timery zostają prawdziwe);
 * c) liczniki: po przebiegu w obu tabelach nie ma wierszy starszych od chwili
 *    przebiegu, a drugi przebieg z tą samą chwilą zwraca zera;
 * d) partie: więcej wygasłych rekordów weryfikacji niż jedna partia (1000)
 *    → wszystkie usunięte w jednym przebiegu.
 *
 * Przebieg działa na całej bazie i zatwierdza zmiany: asercje o wierszach tylko
 * dla id utworzonych przez test, liczniki „co najmniej własne”. Kasuje wyłącznie
 * wiersze już wygasłe, więc wiersze seeda (ważne rok) zostają.
 *
 * Mocki: logger. `@/lib/db` → pula testu (pula systemowa to ten sam klient).
 * Dane: użytkownik `it-t3-authret-…` (sesje kaskadą z użytkownika), rekordy
 * weryfikacji z identyfikatorem `it-t3-authret-…`; sprzątane w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/auth-retention.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate`.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, like, lt } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { session, user, verification } from "@/lib/schema";
import { cleanupExpiredAuthRecords } from "@/lib/server/system/auth-retention";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const PREFIX = `it-t3-authret-${RUN}`;
const USER_ID = `${PREFIX}-u`;
const HOUR = 60 * 60 * 1000;
const BATCH = 1000;

const suite = h ? describe : describe.skip;

/** Chwila przebiegu: obecny czas, zamrożony dla `Date`. */
function freezeNow(): Date {
  const now = new Date();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return now;
}

let seq = 0;
const nextId = (kind: string) => `${PREFIX}-${kind}-${(seq += 1)}`;

async function insertSession(expiresAt: Date): Promise<string> {
  const id = nextId("s");
  await h!.db.insert(session).values({ id, token: `${id}-tok`, expiresAt, userId: USER_ID, updatedAt: new Date() });
  return id;
}

async function insertVerification(expiresAt: Date): Promise<string> {
  const id = nextId("v");
  await h!.db.insert(verification).values({ id, identifier: `${PREFIX}-ident`, value: "x", expiresAt });
  return id;
}

async function existingSessions(ids: string[]): Promise<string[]> {
  const rows = await h!.db.select({ id: session.id }).from(session).where(inArray(session.id, ids));
  return rows.map((r) => r.id).sort();
}

async function existingVerifications(ids: string[]): Promise<string[]> {
  const rows = await h!.db.select({ id: verification.id }).from(verification).where(inArray(verification.id, ids));
  return rows.map((r) => r.id).sort();
}

suite("retencja tabel auth (session, verification), prawdziwy Postgres", () => {
  beforeAll(async () => {
    await h!.db
      .insert(user)
      .values({ id: USER_ID, name: `IT T3 authret ${RUN}`, email: `${USER_ID}@example.invalid`, emailVerified: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (!h) return;
    try {
      await h.db.delete(verification).where(like(verification.identifier, `${PREFIX}%`));
      await h.db.delete(user).where(eq(user.id, USER_ID)); // sesje kaskadą
    } finally {
      await h.end();
    }
  });

  it("a) wygasłe znikają, aktywne zostają; liczniki obejmują własne wygasłe", async () => {
    const now = new Date();
    const expiredS = await insertSession(new Date(now.getTime() - HOUR));
    const activeS = await insertSession(new Date(now.getTime() + HOUR));
    const expiredV = await insertVerification(new Date(now.getTime() - HOUR));
    const activeV = await insertVerification(new Date(now.getTime() + HOUR));

    const result = await cleanupExpiredAuthRecords();

    expect(await existingSessions([expiredS, activeS])).toEqual([activeS]);
    expect(await existingVerifications([expiredV, activeV])).toEqual([activeV]);
    expect(result.deletedSessions).toBeGreaterThanOrEqual(1);
    expect(result.deletedVerifications).toBeGreaterThanOrEqual(1);
    expect(result.complete).toBe(true);
  });

  it("b) granica: expires_at = chwila przebiegu zostaje, o 1 ms wcześniej znika", async () => {
    const now = freezeNow();
    const atS = await insertSession(now);
    const justBeforeS = await insertSession(new Date(now.getTime() - 1));
    const atV = await insertVerification(now);
    const justBeforeV = await insertVerification(new Date(now.getTime() - 1));

    await cleanupExpiredAuthRecords();

    expect(await existingSessions([atS, justBeforeS])).toEqual([atS]);
    expect(await existingVerifications([atV, justBeforeV])).toEqual([atV]);
  });

  it("c) liczniki zgodne z tabelą: po przebiegu 0 wierszy starszych od chwili przebiegu, drugi przebieg = zera", async () => {
    const now = freezeNow();
    const ownS = [await insertSession(new Date(now.getTime() - HOUR)), await insertSession(new Date(now.getTime() - 2 * HOUR))];
    const ownV = [await insertVerification(new Date(now.getTime() - HOUR))];

    const first = await cleanupExpiredAuthRecords();

    expect(first.deletedSessions).toBeGreaterThanOrEqual(ownS.length);
    expect(first.deletedVerifications).toBeGreaterThanOrEqual(ownV.length);
    expect(await existingSessions(ownS)).toEqual([]);
    expect(await existingVerifications(ownV)).toEqual([]);

    const leftS = await h!.db.select({ id: session.id }).from(session).where(lt(session.expiresAt, now));
    const leftV = await h!.db.select({ id: verification.id }).from(verification).where(lt(verification.expiresAt, now));
    expect(leftS).toEqual([]);
    expect(leftV).toEqual([]);

    const second = await cleanupExpiredAuthRecords();
    expect(second).toEqual({ deletedSessions: 0, deletedVerifications: 0, complete: true });
  });

  it("d) więcej wygasłych niż jedna partia → wszystkie usunięte w jednym przebiegu", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - HOUR);
    const count = 2 * BATCH + 5;
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `${PREFIX}-bulk-${i}`,
      identifier: `${PREFIX}-bulk`,
      value: "x",
      expiresAt,
    }));
    for (let i = 0; i < rows.length; i += 500) await h!.db.insert(verification).values(rows.slice(i, i + 500));

    const result = await cleanupExpiredAuthRecords();

    expect(result.deletedVerifications).toBeGreaterThanOrEqual(count);
    expect(result.complete).toBe(true);
    const [left] = await h!.db
      .select({ id: verification.id })
      .from(verification)
      .where(eq(verification.identifier, `${PREFIX}-bulk`))
      .limit(1);
    expect(left).toBeUndefined();
  });
});

/**
 * `src/lib/db.ts` łączy się leniwie (C3, issue #110): import modułu nie wymaga
 * POSTGRES_URL, więc `next build` i obraz Dockera budują się bez adresu bazy.
 * Brak adresu w czasie działania nadal jest jawnym błędem — przy pierwszym
 * użyciu `db`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const postgresMock = vi.fn((_url: string, _opts?: unknown) => ({ fake: "client" }));
const drizzleMock = vi.fn((_client: unknown, _opts?: unknown) => ({
  marker: "drizzle-db",
  select(this: { marker: string }) {
    return this.marker;
  },
}));

vi.mock("postgres", () => ({ default: (url: string, opts?: unknown) => postgresMock(url, opts) }));
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: unknown, opts?: unknown) => drizzleMock(client, opts),
}));

async function loadDb() {
  vi.resetModules();
  return (await import("@/lib/db")).db as unknown as { select: () => string; marker: string };
}

describe("db — leniwe połączenie", () => {
  beforeEach(() => {
    postgresMock.mockClear();
    drizzleMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("import bez POSTGRES_URL nie rzuca i nie otwiera połączenia", async () => {
    vi.stubEnv("POSTGRES_URL", "");
    await expect(loadDb()).resolves.toBeDefined();
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("pierwsze użycie bez POSTGRES_URL rzuca jawny błąd", async () => {
    vi.stubEnv("POSTGRES_URL", "");
    const db = await loadDb();
    expect(() => db.select()).toThrow("POSTGRES_URL environment variable is not set");
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("db nie jest thenable: await/zwrot z async nie otwiera połączenia ani nie rzuca", async () => {
    vi.stubEnv("POSTGRES_URL", "");
    const db = await loadDb();
    expect((db as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(db)).resolves.toBe(db);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("z POSTGRES_URL tworzy klienta raz, przy pierwszym użyciu, z tą samą konfiguracją", async () => {
    vi.stubEnv("POSTGRES_URL", "postgresql://u:p@127.0.0.1:5432/x");
    vi.stubEnv("DB_POOL_MAX", "7");
    const db = await loadDb();
    expect(postgresMock).not.toHaveBeenCalled();

    expect(db.select()).toBe("drizzle-db"); // metoda związana z prawdziwą instancją (this)
    expect(db.marker).toBe("drizzle-db");
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(postgresMock).toHaveBeenCalledWith("postgresql://u:p@127.0.0.1:5432/x", {
      prepare: false,
      max: 7,
      connect_timeout: 5,
      idle_timeout: 20,
      max_lifetime: 1800,
    });
    expect(drizzleMock).toHaveBeenCalledTimes(1);
  });

  it("Cloud SQL: ?host=/cloudsql/… → opcja path (gniazdo), host usunięty z adresu (K-1)", async () => {
    vi.stubEnv(
      "POSTGRES_URL",
      "postgresql://myhelper_owner:pw@localhost/myhelper?host=/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg",
    );
    const db = await loadDb();
    db.select();
    expect(postgresMock).toHaveBeenCalledTimes(1);
    const [url, opts] = postgresMock.mock.calls[0]!;
    expect(url).toBe("postgresql://myhelper_owner:pw@localhost/myhelper");
    expect(opts).toMatchObject({
      path: "/cloudsql/my-helper-2-488419:europe-central2:myhelper-pg/.s.PGSQL.5432",
      prepare: false,
    });
  });

  it("adres TCP bez parametru host: bez opcji path, adres bez zmian", async () => {
    vi.stubEnv("POSTGRES_URL", "postgresql://u:p@127.0.0.1:5432/x?sslmode=require");
    const db = await loadDb();
    db.select();
    const [url, opts] = postgresMock.mock.calls[0]!;
    expect(url).toBe("postgresql://u:p@127.0.0.1:5432/x?sslmode=require");
    expect(opts).not.toHaveProperty("path");
  });

  it("nieprawidłowy adres: błąd bez adresu i hasła w treści", async () => {
    vi.stubEnv("POSTGRES_URL", "postgresql://u:TAJNE-HASLO@ho st/x");
    const db = await loadDb();
    let err: unknown;
    try {
      db.select();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(JSON.stringify({ m: (err as Error).message, s: (err as Error).stack, c: (err as Error).cause, ...(err as object) })).not.toContain("TAJNE-HASLO");
    expect(postgresMock).not.toHaveBeenCalled();
  });
});

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
});

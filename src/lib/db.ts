import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Konfiguracja pod serverless (Vercel Fluid Compute) + pooler transakcyjny
// (Neon/PgBouncer):
// - prepare: false — nazwane prepared statements nie przeżywają transaction
//   poolingu (błędy "prepared statement s1 already exists/does not exist"),
// - max z DB_POOL_MAX (domyślnie 5) — domyślne 10 połączeń × N instancji
//   funkcji szybko wyczerpuje limit połączeń bazy.
function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX) || 5,
    connect_timeout: 5, // 5 second connection timeout
    idle_timeout: 20,   // 20 second idle timeout
    max_lifetime: 60 * 30, // 30 minute max connection lifetime
  });
  return drizzle(client, { schema });
}

type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

/**
 * Połączenie tworzone leniwie, przy pierwszym użyciu `db` — nie przy imporcie
 * (C3, issue #110). Dzięki temu `next build` (zbieranie danych stron) i obraz
 * Dockera budują się bez adresu bazy i bez wartości zastępczej, a brak
 * POSTGRES_URL w czasie działania nadal kończy się jawnym błędem — przy
 * pierwszym zapytaniu (np. /api/health → 503), nie cichym fallbackiem.
 */
function getDb(): Db {
  if (!instance) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL environment variable is not set");
    }
    instance = createDb(connectionString);
  }
  return instance;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    // `db` nie jest obietnicą: `await`/`Promise.resolve(db)` i zwrot z funkcji
    // async sprawdzają `.then` — to nie może otwierać połączenia ani rzucać.
    if (prop === "then") return undefined;
    const real = getDb();
    const value: unknown = Reflect.get(real, prop, real);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return Reflect.has(getDb(), prop);
  },
});

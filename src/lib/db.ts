import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.POSTGRES_URL as string;

if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable is not set");
}

// Konfiguracja pod serverless (Vercel Fluid Compute) + pooler transakcyjny
// (Neon/PgBouncer):
// - prepare: false — nazwane prepared statements nie przeżywają transaction
//   poolingu (błędy "prepared statement s1 already exists/does not exist"),
// - max z DB_POOL_MAX (domyślnie 5) — domyślne 10 połączeń × N instancji
//   funkcji szybko wyczerpuje limit połączeń bazy.
const client = postgres(connectionString, {
  prepare: false,
  max: Number(process.env.DB_POOL_MAX) || 5,
  connect_timeout: 5, // 5 second connection timeout
  idle_timeout: 20,   // 20 second idle timeout
  max_lifetime: 60 * 30, // 30 minute max connection lifetime
});

export const db = drizzle(client, { schema });

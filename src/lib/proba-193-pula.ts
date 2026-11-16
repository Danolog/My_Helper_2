// PRÓBA — NIE SCALAĆ. Lint w CI ma odrzucić własny klient puli poza src/lib/db.ts (#193).
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

export function probaPula(url: string) {
  return drizzle(postgres(url));
}

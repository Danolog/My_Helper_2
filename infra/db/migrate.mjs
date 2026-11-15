// Migracje bazy dla Cloud Run Job `myhelper-migrate` (Dockerfile, etap `migrator`).
//
// Zastępuje `pnpm db:migrate` (drizzle-kit, zależność deweloperska) w obrazie:
// obraz migratora ma tylko zależności produkcyjne (Ryan, #110 P2).
// drizzle-orm/migrator czyta te same pliki `drizzle/*.sql` + `meta/_journal.json`
// i ten sam dziennik `drizzle.__drizzle_migrations` co `drizzle-kit migrate`,
// więc bazy migrowane jednym i drugim są zgodne. Ponowne uruchomienie bez
// nowych migracji niczego nie zmienia (idempotentne).
//
// Wejście: POSTGRES_URL (Secret Manager → env Joba), opcjonalnie MIGRATIONS_DIR
// (domyślnie ./drizzle względem katalogu roboczego). Adres bazy nie jest nigdy
// wypisywany.
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
// Cloud SQL przez gniazdo (`?host=/cloudsql/…` → opcja `path`), jak src/lib/db.ts.
import { socketAwareConnection } from "./pg-socket.mjs";

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("[migrate] POSTGRES_URL is not set");
  process.exit(1);
}

const migrationsFolder = resolve(process.env.MIGRATIONS_DIR || "drizzle");
let connection;
try {
  connection = socketAwareConnection(url);
} catch (error) {
  // Komunikat helpera nie zawiera adresu.
  console.error("[migrate] failed:", error instanceof Error ? error.message : "invalid POSTGRES_URL");
  process.exit(1);
}
const sql = postgres(connection.url, {
  ...(connection.path ? { path: connection.path } : {}),
  max: 1,
  prepare: false,
  onnotice: () => {},
});

try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("[migrate] done");
} catch (error) {
  console.error("[migrate] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

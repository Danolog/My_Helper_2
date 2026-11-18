// Połączenie z Cloud SQL przez gniazdo uniksowe (K-1, #121 a).
//
// Sekret POSTGRES_URL na Cloud Run (decyzja architektoniczna, #121):
//   postgresql://USER:HASŁO@localhost/BAZA?host=/cloudsql/PROJEKT:REGION:INSTANCJA
// postgres@3.4.8 ignoruje parametr zapytania `host` jako adres: bierze hosta
// z części przed `/` (localhost → TCP, odmowa połączenia), a `host` z zapytania
// wysyła serwerowi jako parametr startowy. Dlatego `host` zaczynający się od
// `/` jest usuwany z adresu i zamieniany na opcję `path` (gniazdo
// `<katalog>/.s.PGSQL.<port>`). Inne adresy przechodzą bez zmian.
//
// Używane przez src/lib/db.ts (aplikacja) i infra/db/migrate.mjs (job
// migracji) — jedno źródło. Adres (z hasłem) nigdy nie trafia do komunikatu
// błędu: błąd parsowania jest zastępowany własnym, bez `cause` i bez `input`.

/**
 * @param {string} connectionString
 * @returns {{ url: string, path: string | undefined }}
 */
export function socketAwareConnection(connectionString) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("POSTGRES_URL is not a valid URL");
  }
  const host = parsed.searchParams.get("host");
  if (!host || !host.startsWith("/")) {
    return { url: connectionString, path: undefined };
  }
  if (parsed.searchParams.getAll("host").length > 1) {
    throw new Error("POSTGRES_URL has more than one host parameter");
  }
  parsed.searchParams.delete("host");
  const port = parsed.port || "5432";
  return { url: parsed.toString(), path: `${host.replace(/\/+$/, "")}/.s.PGSQL.${port}` };
}

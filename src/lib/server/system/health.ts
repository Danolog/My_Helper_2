/**
 * Wyjście systemowe (#193): stan bazy dla /api/health i /api/diagnostics.
 * Bez danych najemcy — tylko ping, sprawdzenie, czy schemat jest zastosowany,
 * i strażnik schematu (liczba migracji w bazie względem dziennika obrazu).
 * Limity czasu i komunikaty dla użytkownika zostają w trasach.
 */
import { sql } from "drizzle-orm";
import { user } from "@/lib/schema";
import { dbSystem } from "./db-system";

/**
 * Przyczyna braku gotowości schematu. Trafia wyłącznie do logu serwera,
 * nigdy do treści odpowiedzi publicznej.
 */
export type SchemaGuardReason =
  | "SCHEMA_BEHIND"
  | "MIGRATIONS_TABLE_MISSING"
  | "MIGRATIONS_TABLE_DENIED"
  | "MIGRATIONS_QUERY_FAILED"
  | "JOURNAL_UNAVAILABLE";

export type SchemaGuardResult =
  | { ready: true; applied: number; expected: number }
  | {
      ready: false;
      reason: SchemaGuardReason;
      applied?: number;
      expected?: number;
      /** SQLSTATE z błędu bazy (pięć znaków [0-9A-Z]), bez komunikatu i adresu. */
      sqlstate?: string;
    };

/**
 * Liczba wpisów dziennika migracji z budowy obrazu. Import JSON trafia do
 * bundla serwera przy budowie, więc liczba odpowiada migracjom, z którymi
 * obraz został zbudowany (etap `runner` nie kopiuje katalogu `drizzle/`).
 * Brak pliku albo zły kształt → `null`.
 */
async function journalEntryCount(): Promise<number | null> {
  try {
    const mod = await import("../../../../drizzle/meta/_journal.json");
    const entries: unknown = (mod.default as { entries?: unknown } | undefined)?.entries;
    return Array.isArray(entries) && entries.length > 0 ? entries.length : null;
  } catch {
    return null;
  }
}

/** SQLSTATE z błędu albo jego `cause` (drizzle owija błąd postgres.js). */
function sqlstateOf(error: unknown): string | undefined {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Strażnik schematu: czy baza ma co najmniej tyle zastosowanych migracji
 * (`drizzle.__drizzle_migrations`), ile wpisów ma dziennik obrazu.
 * Mniej → niegotowe (kod obrazu oczekuje tabel i kolumn, których baza nie ma).
 * Więcej albo tyle samo → gotowe (więcej = obraz starszy od bazy, np. cofnięcie
 * rewizji po migracji). Nie rzuca: każdy błąd to wynik `ready: false` z kodem.
 */
export async function checkSchemaMigrations(): Promise<SchemaGuardResult> {
  const expected = await journalEntryCount();
  if (expected === null) return { ready: false, reason: "JOURNAL_UNAVAILABLE" };

  let applied: number;
  try {
    const rows = await dbSystem.execute<{ applied: number }>(
      sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`
    );
    const value = Array.from(rows)[0]?.applied;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return { ready: false, reason: "MIGRATIONS_QUERY_FAILED", expected };
    }
    applied = value;
  } catch (error) {
    const sqlstate = sqlstateOf(error);
    // 42P01: brak tabeli albo schematu `drizzle`; 42501: brak uprawnień.
    const reason: SchemaGuardReason =
      sqlstate === "42P01"
        ? "MIGRATIONS_TABLE_MISSING"
        : sqlstate === "42501"
          ? "MIGRATIONS_TABLE_DENIED"
          : "MIGRATIONS_QUERY_FAILED";
    return { ready: false, reason, expected, ...(sqlstate ? { sqlstate } : {}) };
  }

  if (applied < expected) return { ready: false, reason: "SCHEMA_BEHIND", applied, expected };
  return { ready: true, applied, expected };
}

/** Ping bazy (`SELECT 1`). Błąd połączenia propaguje do wołającego. */
export async function pingDatabase(): Promise<void> {
  await dbSystem.execute(sql`SELECT 1 as connected`);
}

/**
 * Ping + dotknięcie tabeli `user` (czy migracje są zastosowane).
 * Brak połączenia albo pusty wynik pingu → odrzuca; brak tabeli → `schemaApplied: false`.
 */
export async function checkDatabase(): Promise<{ connected: boolean; schemaApplied: boolean }> {
  const result = await dbSystem.execute(sql`SELECT 1 as ping`);
  if (!result) {
    throw new Error("Database query returned no result");
  }
  try {
    await dbSystem.select({ id: user.id }).from(user).limit(1);
    return { connected: true, schemaApplied: true };
  } catch {
    return { connected: true, schemaApplied: false };
  }
}

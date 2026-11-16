/**
 * Wyjście systemowe (#193): stan bazy dla /api/health i /api/diagnostics.
 * Bez danych najemcy — tylko ping i sprawdzenie, czy schemat jest zastosowany.
 * Limity czasu i komunikaty dla użytkownika zostają w trasach.
 */
import { sql } from "drizzle-orm";
import { user } from "@/lib/schema";
import { dbSystem } from "./db-system";

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

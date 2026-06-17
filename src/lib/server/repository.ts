/**
 * Warstwa repozytorium — JEDYNY punkt dostępu do `db` w `src/app/api/**`.
 *
 * Cel (ADR-001, sekcja 2): zamienić izolację salonów „opartą na pamięci
 * programisty" (każda trasa ręcznie dopisuje `eq(salonId)`) na izolację
 * WYMUSZONĄ strukturalnie. `forSalon(salonId)` nie da się wywołać bez
 * salonId (fail-fast), a każda operacja automatycznie domyka `eq(salonId)`.
 *
 * Dwie tamy w jednej warstwie:
 *   1. Filtr aplikacyjny `eq(salonId)` — generowany tu, nigdy nieusuwany.
 *   2. Kontekst RLS — każda operacja biegnie w transakcji z
 *      `SET LOCAL app.current_salon_id = '<uuid>'`, więc baza (RLS, ADR sekcja 3)
 *      odrzuca cudzy wiersz nawet, gdyby filtr aplikacyjny zawiódł.
 *
 * `SET LOCAL` (ustawienie zmiennej sesji obowiązujące tylko do końca bieżącej
 * transakcji) znika po COMMIT/ROLLBACK — kontekst NIE wycieka między żądaniami
 * na współdzielonym poolu połączeń. Na sterowniku postgres-js cała transakcja
 * `db.transaction(...)` biegnie na jednym połączeniu, więc `SET LOCAL`
 * ustawiony pierwszą instrukcją obowiązuje wszystkie zapytania tej transakcji.
 */
import { and, eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";

/** Tabela salon-scoped: musi mieć kolumny `.id` i `.salonId`. */
type SalonScoped = PgTable & { id: AnyColumn; salonId: AnyColumn };

/** Klient transakcyjny postgres-js (parametr callbacku db.transaction). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Uruchom funkcję w transakcji z ustawionym kontekstem RLS dla salonu.
 * `SET LOCAL` jest pierwszą instrukcją — obowiązuje resztę transakcji, znika
 * po jej zakończeniu. Wartość przekazujemy jako parametr (`set_config`), nie
 * przez interpolację stringa — `SET LOCAL app.x = $1` nie jest dozwolone w SQL,
 * dlatego używamy `set_config('app.current_salon_id', $1, true)` (true = LOCAL).
 */
function withSalonContext<T>(salonId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_salon_id', ${salonId}, true)`);
    return fn(tx);
  });
}

/**
 * Brama danych zawężona do jednego salonu (najemcy).
 *
 * @throws Error gdy salonId puste — pominięcie scope jest NIEMOŻLIWE do
 *   napisania, nie „łatwe do zapomnienia" (fail-fast, nie ciche
 *   `WHERE salon_id = undefined`).
 */
export function forSalon(salonId: string) {
  if (!salonId) {
    throw new Error("repository.forSalon: salonId wymagany");
  }

  return {
    /** Wiersz w MOIM salonie albo null — nigdy cudzy. Trasa: null => 404. */
    findOne<T extends SalonScoped>(table: T, id: string): Promise<T["$inferSelect"] | null> {
      return withSalonContext(salonId, async (tx) => {
        const rows = await tx
          .select()
          .from(table as PgTable)
          .where(and(eq(table.id, id), eq(table.salonId, salonId)))
          .limit(1);
        return (rows[0] as T["$inferSelect"]) ?? null;
      });
    },

    /**
     * Update zawężony do salonu. Puste `.returning()` => brak wiersza => 404
     * w trasie. Zwraca zaktualizowany wiersz albo null.
     */
    updateOwned<T extends SalonScoped>(
      table: T,
      id: string,
      data: Partial<T["$inferInsert"]>
    ): Promise<T["$inferSelect"] | null> {
      return withSalonContext(salonId, async (tx) => {
        const rows = await tx
          .update(table)
          .set(data)
          .where(and(eq(table.id, id), eq(table.salonId, salonId)))
          .returning();
        return (rows[0] as T["$inferSelect"]) ?? null;
      });
    },

    /**
     * Delete zawężony do salonu. Puste `.returning()` => brak wiersza => 404.
     * Zwraca usunięty wiersz albo null.
     */
    deleteOwned<T extends SalonScoped>(table: T, id: string): Promise<T["$inferSelect"] | null> {
      return withSalonContext(salonId, async (tx) => {
        const rows = await tx
          .delete(table)
          .where(and(eq(table.id, id), eq(table.salonId, salonId)))
          .returning();
        return (rows[0] as T["$inferSelect"]) ?? null;
      });
    },

    /** Lista wierszy salonu, opcjonalnie z dodatkowym warunkiem. */
    listOwned<T extends SalonScoped>(table: T, extra?: SQL): Promise<T["$inferSelect"][]> {
      return withSalonContext(salonId, async (tx) => {
        const where = extra ? and(eq(table.salonId, salonId), extra) : eq(table.salonId, salonId);
        const rows = await tx.select().from(table as PgTable).where(where);
        return rows as T["$inferSelect"][];
      });
    },

    /**
     * Złożone zapytania (joiny, agregacje) — dostajesz klienta transakcyjny
     * `tx` z USTAWIONYM kontekstem RLS. OBOWIĄZEK: dopisz jawne `eq(salonId)`
     * w `where` (defense in depth — filtr aplikacyjny nie znika z radaru).
     * Przykład: `raw((tx) => tx.select(...).from(a).leftJoin(b, ...).where(and(eq(a.id, id), eq(a.salonId, salonId))))`.
     */
    raw<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return withSalonContext(salonId, fn);
    },

    /** salonId tej bramy — do jawnego dopisania w `raw(...)`. */
    salonId,
  };
}

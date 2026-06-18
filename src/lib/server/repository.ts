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
 *      `SET LOCAL ROLE myhelper_app` + `SET LOCAL app.current_salon_id = '<uuid>'`,
 *      więc baza (RLS, ADR sekcja 3) odrzuca cudzy wiersz nawet, gdyby filtr
 *      aplikacyjny zawiódł.
 *
 * DLACZEGO `SET LOCAL ROLE` (naprawa W1 z review Ryana, ADR-001-ryan-review-rls):
 * pula połączeń aplikacji loguje się rolą OWNER (`dev_user`/prod owner). Pod
 * `ENABLE`-not-`FORCE` owner OMIJA polityki RLS. Gdyby transakcja żądania jechała
 * ownerem, RLS byłby martwą literą na ścieżce żądania — izolację dawałby tylko
 * filtr aplikacyjny (JEDNA tama, nie deklarowane „defense in depth"). Dlatego
 * KAŻDA transakcja ścieżki żądania przełącza się najpierw na rolę `myhelper_app`
 * (bez BYPASSRLS) przez `SET LOCAL ROLE` — wtedy baza realnie odcina cudze wiersze.
 *
 * `SET LOCAL` (ustawienie obowiązujące tylko do końca bieżącej transakcji —
 * dotyczy i ROLE, i zmiennej `app.current_salon_id`) znika po COMMIT/ROLLBACK:
 * ani rola, ani kontekst NIE wyciekają między żądaniami na współdzielonym poolu.
 * Na sterowniku postgres-js cała transakcja `db.transaction(...)` biegnie na
 * jednym połączeniu, więc obie instrukcje `SET LOCAL` obowiązują resztę transakcji.
 *
 * ŚCIEŻKI SYSTEMOWE (webhooki Stripe/Twilio, crony, seed, migracje) NIE przechodzą
 * przez ten wrapper — używają surowego `db` (rola owner, świadomy bypass RLS),
 * bo nie mają zalogowanego właściciela salonu. To celowe (ADR sekcja 4): owner
 * wykonuje je z kontekstem wyznaczanym z danych (np. salon z subskrypcji), nie z
 * sesji. Nigdy nie wołają `forSalon(...)`.
 */
import { and, eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";

/**
 * Nazwa roli aplikacyjnej (bez BYPASSRLS), na którą przełącza się ścieżka żądania.
 * Konfigurowalna przez env (spójne z testem RLS), domyślnie `myhelper_app`.
 * Walidowana jako identyfikator PostgreSQL — `SET ROLE` nie przyjmuje parametru
 * bindowanego, więc nazwa musi trafić do SQL jako literał. Ograniczenie do
 * [a-z_][a-z0-9_]* zamyka jakąkolwiek możliwość wstrzyknięcia (i tak źródłem jest
 * stała/env, nie wejście użytkownika, ale waliduje­my dla pewności).
 */
const APP_DB_ROLE: string = (() => {
  const raw = process.env.MYHELPER_APP_DB_ROLE ?? "myhelper_app";
  if (!/^[a-z_][a-z0-9_]*$/.test(raw)) {
    throw new Error(
      `repository: MYHELPER_APP_DB_ROLE "${raw}" nie jest poprawnym identyfikatorem roli`
    );
  }
  return raw;
})();

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
    // 1. Przełącz transakcję na rolę app BEZ BYPASSRLS (naprawa W1). Nazwa roli
    //    jest zwalidowanym identyfikatorem (APP_DB_ROLE) — `SET ROLE` nie przyjmuje
    //    parametru bindowanego, dlatego literał + walidacja, nie interpolacja wejścia.
    await tx.execute(sql.raw(`set local role ${APP_DB_ROLE}`));
    // 2. Ustaw kontekst salonu — RLS porówna salon_id z tą wartością.
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

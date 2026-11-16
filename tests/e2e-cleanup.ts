/**
 * Sprzątanie danych E2E (#175): znacznik testu i twarde usunięcie oznaczonych wizyt.
 *
 * Dlaczego twardo: `DELETE /api/appointments/[id]` w aplikacji tylko anuluje
 * (`status = cancelled`), wiersz zostaje. `afterEach` w specach nadal anuluje,
 * bo zwalnia termin dla kolejnych testów w tym samym przebiegu. Usunięcie
 * wierszy robi dopiero `globalTeardown` (`tests/global-teardown.ts`).
 *
 * Znacznik: wizyta jest „z E2E”, gdy `notes` albo `guest_name` zaczyna się od
 * `[E2E]`. `notes` ustawia panel (API i formularz „Nowa wizyta”), `guest_name`
 * portal gościa, bo formularz rezerwacji nie ma pola uwag. Seed
 * (`scripts/seed-test.ts`) nie tworzy wizyt, a ręcznie umówiona wizyta nie ma
 * tego prefiksu, więc teardown jej nie dotknie.
 *
 * Moduł bez importów aplikacji ("@/…"): ładuje go Playwright i Vitest.
 */
import * as fs from "fs";
import { parseEnv } from "util";
import postgres, { type Sql } from "postgres";
import {
  checkSeedClientOptions,
  checkSeedTarget,
  type SeedGuardContext,
  verifySeedServerIdentities,
} from "../scripts/seed-host-guard";

export const E2E_MARKER = "[E2E]";

export const CLEANUP_GUARD_CONTEXT: SeedGuardContext = { subject: "teardown E2E", varName: "POSTGRES_URL" };

/**
 * Adres bazy serwera testów: `POSTGRES_URL` z procesu, a bez niego z `.env.local`.
 * Z pliku brany jest WYŁĄCZNIE `POSTGRES_URL`; reszta nie trafia do `process.env`
 * (np. `STRIPE_SECRET_KEY` zmieniłby zachowanie specu zadatku).
 */
/** Zmienne, które czyta teardown (zgodne z `process.env`). */
export type CleanupEnv = { readonly [key: string]: string | undefined };

export function resolveCleanupUrl(env: CleanupEnv, envLocalPath: string): string | undefined {
  const fromEnv = env.POSTGRES_URL?.trim();
  if (fromEnv) return fromEnv;
  if (!fs.existsSync(envLocalPath)) return undefined;
  return parseEnv(fs.readFileSync(envLocalPath, "utf8")).POSTGRES_URL?.trim() || undefined;
}

/**
 * Klient postgres.js po trzech etapach strażnika seeda (napis URL → hosty
 * wyliczone przez postgres.js → tożsamość serwera), zanim padnie pierwszy zapis.
 * Odmowa = wyjątek z powodem; komunikat bez URL i poświadczeń.
 */
export async function guardedCleanupClient(url: string | undefined, env: CleanupEnv): Promise<Sql> {
  const target = checkSeedTarget(url, { VERCEL_ENV: env.VERCEL_ENV }, CLEANUP_GUARD_CONTEXT);
  if (!target.ok) throw new Error(`[e2e-cleanup] Odmowa: ${target.reason}`);
  const sql = postgres(url!, { prepare: false, max: 1, connect_timeout: 5, onnotice: () => {} });
  const client = checkSeedClientOptions(sql.options, CLEANUP_GUARD_CONTEXT);
  if (!client.ok) {
    await sql.end({ timeout: 0 });
    throw new Error(`[e2e-cleanup] Odmowa: ${client.reason}`);
  }
  const server = await verifySeedServerIdentities([sql], CLEANUP_GUARD_CONTEXT);
  if (!server.ok) throw new Error(`[e2e-cleanup] Odmowa: ${server.reason}`);
  return sql;
}

/** Uwagi wizyty z panelu: `[E2E] <opis>`. */
export function e2eNotes(label: string): string {
  return `${E2E_MARKER} ${label}`;
}

/** Imię gościa z portalu: `[E2E] <imię>`. */
export function e2eGuestName(name: string): string {
  return `${E2E_MARKER} ${name}`;
}

/** Salon seeda (`scripts/seed-test.ts`) — jedyny, w którym E2E zakładają wizyty. */
export const E2E_SALON_ID = "00000000-0000-4000-8000-000000000001";

export type PurgeResult = { deleted: number; untouchedBefore: number; untouchedAfter: number };

/**
 * Usuwa wizyty ze znacznikiem w podanych salonach, w jednej transakcji.
 * Zależne wiersze znikają kaskadą FK (`deposit_payments`, `appointment_materials`,
 * `treatment_history`, `product_usage`, `employee_commissions`, `fiscal_receipts`).
 *
 * Bezpiecznik niezależny od filtra DELETE: przed i po usunięciu liczy wizyty
 * BEZ znacznika w całej tabeli. Jeśli liczba się zmieni (np. ktoś zgubi filtr
 * znacznika), transakcja jest wycofywana i funkcja rzuca błąd.
 */
export async function purgeE2eAppointments(sql: Sql, salonIds: readonly string[]): Promise<PurgeResult> {
  if (salonIds.length === 0) throw new Error("[e2e-cleanup] brak salonów do sprzątania");
  // REPEATABLE READ: oba liczenia widzą ten sam stan, więc wizyta zapisana w tym
  // czasie przez kogoś innego nie wywoła fałszywego alarmu.
  return sql.begin("isolation level repeatable read", async (txSql) => {
    // TransactionSql w typach postgres.js gubi sygnaturę wywołania (Omit) — w runtime jest wywoływalna
    // (ten sam zabieg co w __tests__/pg/deposit-confirmation.pg.test.ts).
    const tx = txSql as unknown as Sql;
    const unmarked = async () => {
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from appointments
        where not (starts_with(coalesce(notes, ''), ${E2E_MARKER})
                or starts_with(coalesce(guest_name, ''), ${E2E_MARKER}))`;
      return row!.n;
    };
    const untouchedBefore = await unmarked();
    const deleted = await tx`
      delete from appointments
      where salon_id = any(${salonIds as string[]}::uuid[])
        and (starts_with(coalesce(notes, ''), ${E2E_MARKER})
          or starts_with(coalesce(guest_name, ''), ${E2E_MARKER}))
      returning id`;
    const untouchedAfter = await unmarked();
    if (untouchedAfter !== untouchedBefore) {
      throw new Error(
        `[e2e-cleanup] wycofano: usunięcie dotknęło wizyt bez znacznika ${E2E_MARKER} ` +
          `(przed ${untouchedBefore}, po ${untouchedAfter})`
      );
    }
    return { deleted: deleted.length, untouchedBefore, untouchedAfter };
  });
}

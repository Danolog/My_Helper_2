/**
 * Setup dla testów integracyjnych na REALNEJ, LOKALNEJ bazie.
 *
 * Dwa zadania, oba krytyczne dla bezpieczeństwa:
 *
 *  1. Załadować zmienne środowiskowe z pliku WSKAZANEGO JAWNIE (poza repo),
 *     a NIE z `.env.local` (które drizzle-kit/Next auto-ładują i które na
 *     maszynie dewelopera potrafi wskazywać produkcję — Neon).
 *
 *  2. GUARD: zanim jakikolwiek import dotknie bazy, twardo sprawdzić, że host
 *     DSN to localhost/127.0.0.1. Jeśli nie — rzucić wyjątkiem i przerwać CAŁY
 *     przebieg testów. To jest tama przed przypadkowym uderzeniem w produkcję.
 *
 * Plik env (poza repo, bez literałów sekretów w repozytorium) wskazuje:
 *   MYHELPER_TEST_ENV  — ścieżka do pliku .env testowego
 *   (domyślnie: <repo>/../myhelper-test.env)
 *
 * Wymagane klucze w pliku env:
 *   POSTGRES_URL       — DSN wskazujący LOKALNĄ bazę (host localhost, port 5440)
 *   BETTER_AUTH_SECRET — dowolny ciąg min. 32 znaki na potrzeby testu
 *   BETTER_AUTH_URL    — http://localhost:3000
 *
 * WYJĄTEK STAGING (RLS_STAGING_HOST) — KONTROLOWANY, WĄSKI, OPT-IN.
 * Runbook prod RLS (docs/security/2026-06-18-prod-rls-rollout-runbook.md, bramka
 * F3) wymaga DOWODU odcięcia cross-tenant na STAGINGU przed prod. Guard domyślnie
 * pozwala TYLKO na localhost — staging (np. Neon) by zablokował. Dlatego wąskie,
 * jawne okno: gdy `RLS_STAGING_HOST` jest ustawione, guard przepuszcza DOKŁADNIE
 * ten jeden host (równość pełna, nie wzorzec) i POMIJA blokadę hostów zdalnych
 * (Neon itd.) WYŁĄCZNIE dla tego hosta. Zasady bezpieczeństwa:
 *   - Podwójny opt-in: zmienna MUSI nazwać host, a host DSN MUSI mu być równy.
 *   - To NIE jest globalne wyłączenie guarda — każdy inny host nadal STOP.
 *   - NIGDY nie wskazuj tu hosta PRODUKCYJNEGO. To furtka na STAGING (bliźniacza,
 *     odrębna baza), nie na prod. Prod RLS = ręczny SQL po sign-offie Darka
 *     (runbook sekcja 3), nie przez ten test.
 *   - Domyślnie (zmienna nieustawiona) zachowanie bez zmian: tylko localhost.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

function loadEnvFile(): void {
  const envPath =
    process.env.MYHELPER_TEST_ENV ??
    resolve(process.cwd(), "..", "myhelper-test.env");

  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    throw new Error(
      `[setup-real-db] Nie znaleziono pliku env testowego: ${envPath}\n` +
        `Ustaw MYHELPER_TEST_ENV na ścieżkę do pliku z POSTGRES_URL wskazującym LOKALNĄ bazę.`
    );
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Zdejmij ewentualne cudzysłowy (pułapka z pamięci repo: cytowana wartość
    // wpadała do procesu z literalnymi znakami i psuła klucz/DSN).
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function assertLocalDb(): void {
  const dsn = process.env.POSTGRES_URL;
  if (!dsn) {
    throw new Error("[setup-real-db] GUARD: brak POSTGRES_URL — STOP.");
  }
  let host: string;
  try {
    host = new URL(dsn).hostname;
  } catch {
    throw new Error("[setup-real-db] GUARD: POSTGRES_URL nie jest poprawnym URL — STOP.");
  }

  // Kontrolowany wyjątek staging (F3): jeśli RLS_STAGING_HOST nazywa DOKŁADNIE
  // host DSN — przepuść właśnie ten jeden host i pomiń blokadę hostów zdalnych
  // TYLKO dla niego. Podwójny opt-in (zmienna + równość hosta). Każdy inny host
  // dalej leci przez normalny guard (localhost-only). Patrz nagłówek pliku.
  const stagingHost = process.env.RLS_STAGING_HOST?.trim();
  if (stagingHost && stagingHost.length > 0 && host === stagingHost) {
    // eslint-disable-next-line no-console
    console.log(
      `[setup-real-db] GUARD: WYJĄTEK STAGING aktywny — host=${host} dopuszczony ` +
        `przez RLS_STAGING_HOST. To okno na STAGING (bramka F3 runbooka RLS), NIE prod.`
    );
    return;
  }

  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[setup-real-db] GUARD ZABLOKOWAŁ: host bazy = "${host}" — to NIE jest localhost.\n` +
        `Test integracyjny NIGDY nie dotyka bazy zdalnej/produkcyjnej. Przerywam.\n` +
        `(Świadomy dowód RLS na staging? Ustaw RLS_STAGING_HOST="${host}" — patrz nagłówek pliku.)`
    );
  }
  // Druga warstwa: jawnie odetnij znane hosty zdalne (np. Neon), nawet gdyby
  // ktoś dodał alias localhost wskazujący gdzie indziej w /etc/hosts.
  if (/neon\.tech|amazonaws|supabase\.co|render\.com/i.test(dsn)) {
    throw new Error(
      `[setup-real-db] GUARD ZABLOKOWAŁ: DSN zawiera wzorzec hosta zdalnego — STOP.`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`[setup-real-db] GUARD OK — baza lokalna, host=${host}`);
}

loadEnvFile();
assertLocalDb();

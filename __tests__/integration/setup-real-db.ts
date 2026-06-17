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
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[setup-real-db] GUARD ZABLOKOWAŁ: host bazy = "${host}" — to NIE jest localhost.\n` +
        `Test integracyjny NIGDY nie dotyka bazy zdalnej/produkcyjnej. Przerywam.`
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

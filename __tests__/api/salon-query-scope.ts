/**
 * Skaner tras API, które czytają `salonId` z query (#94, niezmiennik z recenzji).
 *
 * Wspólny dla:
 *   - `salon-query-scope-invariant.test.ts` — analiza tekstowa źródeł,
 *   - `salon-query-scope-contract.test.ts` — wywołanie handlerów
 *     „konto salonu A z salonId=B”.
 *
 * Jednostką jest eksportowany handler (`export const GET = …`,
 * `export async function DELETE(…)`), nie plik: plik z jednym strzeżonym
 * i jednym niestrzeżonym handlerem nie przechodzi.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const ROOT = resolve(__dirname, "../..");
const API = join(ROOT, "src/app/api");

/** Każdy odczyt `salonId` z query: `searchParams.get("salonId")` w dowolnym cudzysłowie. */
export const SALON_ID_QUERY_READ = /\.get\(\s*["'`]salonId["'`]\s*\)/;

const HANDLER_START = /^export\s+(?:const\s+|async\s+function\s+|function\s+)(GET|POST|PUT|PATCH|DELETE)\b/gm;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface QueryHandler {
  /** Ścieżka względem repo, np. `src/app/api/services/route.ts`. */
  file: string;
  method: HttpMethod;
  /** Tekst handlera: od `export …` do następnego eksportu handlera albo końca pliku. */
  body: string;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

/**
 * Źródło trasy bez komentarzy: komentarz „wcześniej szło do forSalon()” nie
 * może udawać zapytania, a zakomentowany strażnik — strażnika. Komentarz
 * liniowy tylko po białym znaku albo na początku linii (nie `http://` w stringu).
 */
export function readRoute(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Wszystkie pliki `route.ts` w `src/app/api`, ścieżki względem repo. */
export function allRouteFiles(): string[] {
  return routeFiles(API).map((path) => relative(ROOT, path)).sort();
}

/** Pliki tras czytające `salonId` z query gdziekolwiek (także poza handlerem). */
export function filesReadingSalonIdQuery(): string[] {
  return allRouteFiles()
    .filter((file) => SALON_ID_QUERY_READ.test(readRoute(file)));
}

/** Handlery, w których ciele jest odczyt `salonId` z query. */
export function handlersReadingSalonIdQuery(): QueryHandler[] {
  const handlers: QueryHandler[] = [];
  for (const file of filesReadingSalonIdQuery()) {
    const text = readRoute(file);
    const starts = [...text.matchAll(HANDLER_START)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1]!.index : text.length;
      const body = text.slice(m.index, end);
      if (SALON_ID_QUERY_READ.test(body)) {
        handlers.push({ file, method: m[1] as HttpMethod, body });
      }
    });
  }
  return handlers;
}

/** Pierwszy dostęp do danych w handlerze: forSalon(…), db.…, tx.… */
const DATA_ACCESS = /\bforSalon\(|\bdb\s*\.\s*(?:select|insert|update|delete|execute|query|transaction)\b|\btx\s*\./;

/**
 * Indeks wzorca w ciele handlera, jeśli występuje PRZED pierwszym dostępem
 * do danych; -1 gdy go nie ma albo jest dopiero po zapytaniu.
 */
export function indexBeforeDataAccess(body: string, pattern: RegExp): number {
  const guard = pattern.exec(body);
  if (!guard) return -1;
  const access = DATA_ACCESS.exec(body);
  return access && access.index < guard.index ? -1 : guard.index;
}

/**
 * Reguła ogólna: wartość z query trafia do strażnika, który porównuje ją
 * z salonem z sesji (inny => 403), a strażnik stoi przed zapytaniem.
 *
 *   - `requireSalonStaff({ …, requestedSalonId: searchParams.get("salonId") })`
 *   - `const requestedSalonId = searchParams.get("salonId")…` + `requireSalonStaff({ requestedSalonId })`
 *   - `requireReportSalon(request)` (czyta query sam; brak => 400, inny => 403)
 */
export function guardedBySessionSalon(body: string): boolean {
  const inline = /requireSalonStaff\(\{[^)]*?requestedSalonId:\s*searchParams\.get\(\s*["'`]salonId["'`]\s*\)/;
  const viaVariable =
    /const\s+requestedSalonId\s*=\s*searchParams\.get\(\s*["'`]salonId["'`]\s*\)/.test(body) &&
    /requireSalonStaff\(\{[^)]*?\brequestedSalonId\b(?!\s*:)[^)]*\}\)/;
  const staff = inline.test(body) ? inline : viaVariable || null;
  if (staff && indexBeforeDataAccess(body, staff) >= 0) return true;
  return indexBeforeDataAccess(body, /requireReportSalon\(request\)/) >= 0;
}

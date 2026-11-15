/**
 * Postać ścieżki żądania przed decyzjami w `src/proxy.ts` — JEDYNE miejsce,
 * w którym ścieżkę się ocenia i normalizuje. Rejestr modułów
 * (`src/lib/features.ts`) i proxy tylko to wołają.
 *
 * Problem: router Next i nasza bramka mogą różnie przeczytać tę samą ścieżkę.
 * Zakodowany ukośnik (`%2f`) albo zakodowane `..` (`%2e%2e`) dla jednego są
 * zwykłym znakiem w segmencie, dla drugiego strukturą ścieżki — a to, co robi
 * router, zależy od wersji Next. Nie zgadujemy:
 *
 * 1. `isAmbiguousPath` — ścieżka z zakodowaną strukturą, błędnym kodowaniem
 *    albo znakiem procentu po jednym dekodowaniu jest odrzucana z góry (proxy odpowiada 404, zanim zadziała
 *    cokolwiek innego). Aplikacja nie ma poprawnych ścieżek tego rodzaju.
 * 2. Wzorce rejestru sprawdza się na DWÓCH postaciach kanonicznych:
 *    `literalCanonicalPath` (bez dekodowania — tak czyta router, który nie
 *    dekoduje) i `decodedCanonicalPath` (po zdekodowaniu — tak czyta router,
 *    który dekoduje). Blokada, jeśli pasuje którakolwiek.
 *
 * Pilnują tego `__tests__/lib/path-normalize.test.ts`,
 * `frozen-modules.test.ts` i `proxy-frozen-modules.test.ts`.
 */

/** Zakodowany ukośnik, odwrócony ukośnik, kropka albo bajt zerowy (dowolna wielkość liter). */
const ENCODED_STRUCTURE = /%(2f|5c|2e|00)/i;
/** Znak procentu, po którym nie ma dwóch cyfr szesnastkowych. */
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i;

/**
 * Czy ścieżkę można przeczytać na więcej niż jeden sposób: zakodowany
 * separator (`%2f`, `%5c`) albo dosłowny odwrócony ukośnik, zakodowana kropka
 * (`%2e`), bajt zerowy, błędne kodowanie procentowe (`%zz`, urwane `%C5`)
 * albo znak procentu, który zostaje PO JEDNYM dekodowaniu.
 *
 * Dekodujemy dokładnie raz. Jeśli w wyniku nadal jest `%`, ścieżka była
 * zakodowana podwójnie (`%252f`, `%2569`) albo niesie dosłowny procent
 * (`%25`) — kolejna warstwa (router, serwer pośredni) mogłaby zdekodować ją
 * jeszcze raz i zobaczyć coś innego niż my, więc jej nie obsługujemy.
 *
 * Poprawnie zakodowane znaki, które nie są strukturą ścieżki — polskie
 * litery (`%C5%82`), spacja (`%20`) — przechodzą.
 */
export function isAmbiguousPath(pathname: string): boolean {
  if (pathname.includes("\\")) return true;
  if (ENCODED_STRUCTURE.test(pathname)) return true;
  if (MALFORMED_ESCAPE.test(pathname)) return true;

  let decodedOnce: string;
  try {
    decodedOnce = decodeURIComponent(pathname);
  } catch {
    // np. urwana sekwencja UTF-8 (`%C5` bez drugiego bajtu)
    return true;
  }
  return decodedOnce.includes("%");
}

/**
 * Wspólna część obu postaci: dosłowne ukośniki (zwykłe i odwrócone) jako
 * separatory, bez pustych segmentów i bez segmentów `.` / `..`, bez ukośnika
 * końcowego, małymi literami.
 */
function canonicalize(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`.toLowerCase();
}

/**
 * Postać kanoniczna BEZ dekodowania: strukturą są wyłącznie dosłowne
 * separatory i dosłowne `.` / `..`. `%2f` i `%2e%2e` zostają zwykłym tekstem
 * w segmencie.
 */
export function literalCanonicalPath(pathname: string): string {
  return canonicalize(pathname);
}

/**
 * Postać kanoniczna PO zdekodowaniu kodowania procentowego: `%69` to `i`,
 * a `%2f` i `%2e%2e` stają się strukturą. Przy błędnym kodowaniu dekodujemy
 * pojedyncze sekwencje ASCII, a błędne zostają — jedno `%zz` nie wyłącza
 * dekodowania reszty ścieżki.
 */
export function decodedCanonicalPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname.replace(/%[0-7][0-9a-f]/gi, (seq) =>
      String.fromCharCode(parseInt(seq.slice(1), 16))
    );
  }
  return canonicalize(decoded);
}

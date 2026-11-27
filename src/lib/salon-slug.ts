/**
 * Krótki adres salonu `/s/<slug>` (plan wejścia na rynek, pkt 2.1, D3).
 *
 * Czyste funkcje bez bazy — używa ich trasa zakładania salonu, trasa zmiany
 * adresu, strona `/s/[slug]` i formularz w panelu. Te same reguły egzekwuje
 * baza: indeks unikalny `salons_slug_uq` i CHECK `salons_slug_format`
 * (format i długość; słów zastrzeżonych baza nie zna — pilnuje ich ten plik).
 *
 * Migracja `drizzle/0018_salons_slug.sql` liczy slug istniejących salonów tym
 * samym algorytmem w SQL (polskie znaki, myślniki, długość, słowa zastrzeżone,
 * sufiks `-2`, `-3` przy konflikcie). Zmiana reguł tutaj = zmiana tam.
 */

export const SALON_SLUG_MIN_LENGTH = 3;
export const SALON_SLUG_MAX_LENGTH = 50;

/** Małe litery i cyfry, pojedyncze myślniki wewnątrz (bez myślnika na początku i końcu). */
export const SALON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Adres zapasowy, gdy z nazwy nie da się złożyć poprawnego sluga. */
export const SALON_SLUG_FALLBACK = "salon";

/** Nazwa indeksu unikalnego — po niej trasa rozpoznaje konflikt adresu (23505). */
export const SALON_SLUG_UNIQUE_INDEX = "salons_slug_uq";

/**
 * Słowa, które nie mogą być adresem salonu: ścieżki aplikacji i nazwy, które
 * klient mógłby wziąć za stronę systemową. Adres żyje pod `/s/`, więc kolizji
 * z trasami dziś nie ma — lista chroni przed mylącymi adresami
 * (`/s/admin`, `/s/login`) i zostawia miejsce na przyszłe ścieżki.
 */
export const RESERVED_SALON_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "appointments",
  "assets",
  "auth",
  "book",
  "booking",
  "calendar",
  "calendar-demo",
  "cennik",
  "contact",
  "dashboard",
  "design-system",
  "dla-klientow",
  "dla-salonow",
  "dpa",
  "favorites",
  "forgot-password",
  "help",
  "kontakt",
  "login",
  "logout",
  "myhelper",
  "null",
  "offline",
  "podprocesorzy",
  "polityka-prywatnosci",
  "pomoc",
  "portal",
  "pricing",
  "privacy",
  "profile",
  "public",
  "register",
  "regulamin",
  "reset-password",
  "rezerwacja",
  "s",
  "salons",
  "settings",
  "signin",
  "signup",
  "static",
  "support",
  "terms",
  "undefined",
  "waiting-list",
  "www",
]);

/** Polskie litery (także wielkie) → ASCII. `ł` nie rozkłada się w NFKD, stąd jawna mapa. */
const POLISH_TRANSLITERATION: Readonly<Record<string, string>> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
};

/** Znaki łączące (akcenty) po rozkładzie NFKD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export type SalonSlugProblem = "format" | "length" | "reserved";

/**
 * Powód, dla którego napis nie jest poprawnym slugiem, albo null, gdy jest.
 * Długość sprawdzana przed formatem — komunikat „za krótki” jest czytelniejszy.
 */
export function salonSlugProblem(value: string): SalonSlugProblem | null {
  if (value.length < SALON_SLUG_MIN_LENGTH || value.length > SALON_SLUG_MAX_LENGTH) return "length";
  if (!SALON_SLUG_PATTERN.test(value)) return "format";
  if (RESERVED_SALON_SLUGS.has(value)) return "reserved";
  return null;
}

export function isValidSalonSlug(value: string): boolean {
  return salonSlugProblem(value) === null;
}

/** Komunikat dla właściciela salonu (formularz w panelu i odpowiedź 400 trasy). */
export function salonSlugProblemMessage(problem: SalonSlugProblem): string {
  switch (problem) {
    case "length":
      return `Adres musi mieć od ${SALON_SLUG_MIN_LENGTH} do ${SALON_SLUG_MAX_LENGTH} znaków.`;
    case "format":
      return "Adres może zawierać tylko małe litery bez polskich znaków, cyfry i pojedyncze myślniki (nie na początku ani na końcu).";
    case "reserved":
      return "Tego adresu nie można użyć. Wybierz inny.";
  }
}

/** Ucina do `max` znaków i zdejmuje myślnik, który po ucięciu został na końcu. */
function truncateSlug(value: string, max: number): string {
  return value.slice(0, max).replace(/-+$/, "");
}

/**
 * Slug z dowolnego tekstu bez sprawdzania długości i listy zastrzeżonej:
 * transliteracja, małe litery, każdy ciąg innych znaków → jeden myślnik,
 * bez myślników na brzegach, najwyżej `SALON_SLUG_MAX_LENGTH` znaków.
 * Może zwrócić pusty napis.
 */
export function normalizeToSlug(text: string): string {
  const ascii = Array.from(text, (ch) => POLISH_TRANSLITERATION[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "");
  const dashed = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateSlug(dashed, SALON_SLUG_MAX_LENGTH);
}

/**
 * Poprawny slug z nazwy salonu (bez sprawdzania zajętości). Gdy z nazwy
 * wychodzi napis za krótki albo zastrzeżony, dostaje przedrostek `salon-`
 * („Admin” → `salon-admin`); pusty → `salon`.
 */
export function slugFromSalonName(name: string): string {
  const base = normalizeToSlug(name);
  if (isValidSalonSlug(base)) return base;
  if (base === "") return SALON_SLUG_FALLBACK;
  return truncateSlug(`${SALON_SLUG_FALLBACK}-${base}`, SALON_SLUG_MAX_LENGTH);
}

/** `base` z sufiksem `-n`, ucięty tak, żeby całość mieściła się w limicie. */
export function slugWithSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${truncateSlug(base, SALON_SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Pierwszy wolny adres: `base`, potem `base-2`, `base-3`… `taken` to slugi
 * już zajęte (wystarczą te równe `base` albo zaczynające się od `base-`).
 */
export function pickAvailableSalonSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = slugWithSuffix(base, n);
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Konflikt indeksu `salons_slug_uq` (23505), także opakowany przez Drizzle
 * w `cause`. postgres-js podaje nazwę w `constraint_name`, node-postgres
 * w `constraint`.
 */
export function isSalonSlugConflict(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    const err = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (
      err.code === "23505" &&
      (err.constraint_name === SALON_SLUG_UNIQUE_INDEX || err.constraint === SALON_SLUG_UNIQUE_INDEX)
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Pełny publiczny adres salonu dla danego originu (bez ukośnika na końcu originu). */
export function salonShortUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${slug}`;
}

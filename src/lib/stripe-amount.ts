/**
 * Kwota i waluta ze Stripe → kolumny wpisu płatności (`amount` numeric(10,2),
 * `currency`) — jedno miejsce przeliczenia.
 *
 * Stripe podaje kwotę w najmniejszych jednostkach waluty (liczba całkowita,
 * np. grosze). Napis kwoty powstaje z ilorazu całkowitego i reszty z dzielenia
 * przez 100, bez zaokrąglania ułamka. Kwota spoza zakresu kolumny, niecałkowita
 * albo nie będąca liczbą, waluta inna niż trzy litery oraz waluta z poniższego
 * zbioru → `null` (wpisu z takich danych nie da się poprawnie zapisać).
 */

/** Najwyższa kwota w najmniejszych jednostkach, która mieści się w numeric(10,2). */
const MAX_MINOR_UNITS = 9_999_999_999;

/**
 * Waluty z tego zbioru nie są przeliczane (najmniejsza jednostka nie jest
 * 1/100): bez miejsc po przecinku oraz z trzema miejscami po przecinku.
 */
const NOT_CONVERTED_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
  "bhd", "jod", "kwd", "omr", "tnd",
]);

export function stripeAmountToColumns(
  minor: unknown,
  currency: unknown
): { amount: string; currency: string } | null {
  if (typeof minor !== "number" || !Number.isSafeInteger(minor)) return null;
  if (minor < 0 || minor > MAX_MINOR_UNITS) return null;
  if (typeof currency !== "string" || !/^[a-z]{3}$/i.test(currency)) return null;

  const code = currency.toLowerCase();
  if (NOT_CONVERTED_CURRENCIES.has(code)) return null;

  const units = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  return { amount: `${units}.${cents}`, currency: code.toUpperCase() };
}

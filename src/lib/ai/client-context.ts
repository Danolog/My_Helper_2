/**
 * Kontekst klienta w zapytaniach do zewnętrznego modelu AI.
 *
 * Jedyne miejsce, które zamienia rekord klienta na linie tekstu zapytania.
 * Do zapytania trafiają tylko pola z listy `CLIENT_CONTEXT_FIELDS`, nawet gdy
 * funkcja dostanie cały rekord z bazy. Klient jest opisany stałym słowem
 * `CLIENT_LABEL` — bez imienia i nazwiska. Nie trafiają tu dane o zdrowiu
 * (`allergies`), dane identyfikujące ani kontaktowe (`firstName`, `lastName`,
 * `phone`, `email`) ani notatki o kliencie (`notes`).
 *
 * Zasada: nowe pole w zapytaniu = świadoma decyzja, zmiana listy i typu w tym
 * pliku oraz aktualizacja `docs/policies/podprocesorzy.md`.
 */

/** Pola rekordu klienta, które wolno przekazać do modelu. */
export const CLIENT_CONTEXT_FIELDS = ["preferences", "birthday"] as const;

export type ClientContextField = (typeof CLIENT_CONTEXT_FIELDS)[number];

/**
 * Wejście pomocnika — wyłącznie pola z białej listy. Można podać cały rekord
 * klienta; funkcja i tak czyta tylko pola wymienione tutaj.
 */
export type ClientContextInput = {
  readonly [K in ClientContextField]?: string | null;
};

/** Stała etykieta klienta w zapytaniu (zamiast imienia i nazwiska). */
export const CLIENT_LABEL = "Klient";

export type ClientContextOptions = {
  /** Dołącz urodziny (tylko dzień i miesiąc, bez roku). Domyślnie nie. */
  includeBirthday?: boolean;
  /** Etykiety linii, żeby trasy zachowały swoje dotychczasowe brzmienie. */
  labels?: {
    /** Domyślnie „Preferencje”. */
    preferences?: string;
    /** Domyślnie „Urodziny”. */
    birthday?: string;
  };
};

/** Tekst w jednej linii: znaki nowej linii i tabulatory zamienione na spacje. */
function toSingleLine(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Dzień i miesiąc z daty `YYYY-MM-DD` (także z doklejonym czasem) jako `DD.MM`.
 * Wartość w innym formacie albo nieprawidłowa daje `null` — surowa wartość
 * nigdy nie trafia do zapytania.
 */
function toDayMonth(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^\s*\d{4}-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[2]}.${match[1]}`;
}

/**
 * Linie kontekstu klienta do zapytania. Brak klienta = brak linii; dla
 * klienta pierwsza linia to zawsze `CLIENT_LABEL`.
 */
export function buildClientContext(
  client: ClientContextInput | null | undefined,
  opts: ClientContextOptions = {},
): string[] {
  if (!client) return [];

  const lines: string[] = [CLIENT_LABEL];

  const preferences = toSingleLine(client.preferences);
  if (preferences) {
    lines.push(`${opts.labels?.preferences ?? "Preferencje"}: ${preferences}`);
  }

  if (opts.includeBirthday) {
    const birthday = toDayMonth(client.birthday);
    if (birthday) {
      lines.push(`${opts.labels?.birthday ?? "Urodziny"}: ${birthday}`);
    }
  }

  return lines;
}

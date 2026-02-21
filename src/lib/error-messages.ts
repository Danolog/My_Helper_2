/**
 * Centralized error message sanitization for user-facing errors.
 *
 * NEVER show raw error.message to users - it may contain:
 * - Stack traces, SQL queries, or internal paths
 * - Third-party SDK errors (Stripe API keys, OpenRouter tokens)
 * - Technical jargon (TypeError, ReferenceError, ECONNREFUSED)
 *
 * This module provides user-friendly Polish messages for all error scenarios.
 */

/** Known error patterns mapped to user-friendly Polish messages */
const ERROR_PATTERN_MAP: Array<{ pattern: RegExp; message: string }> = [
  // Auth errors (Better Auth SDK)
  {
    pattern: /user already exists/i,
    message: "Konto z tym adresem email juz istnieje. Uzyj innego adresu lub zaloguj sie.",
  },
  {
    pattern: /invalid (email|credentials|password)/i,
    message: "Nieprawidlowy email lub haslo. Sprawdz dane i sprobuj ponownie.",
  },
  {
    pattern: /email.*(not found|does not exist)/i,
    message: "Nie znaleziono konta z tym adresem email.",
  },
  {
    pattern: /password.*(too short|too weak|min)/i,
    message: "Haslo jest za krotkie. Wpisz co najmniej 8 znakow.",
  },
  {
    pattern: /token.*(invalid|expired)/i,
    message: "Link wygasl lub jest nieprawidlowy. Sprobuj ponownie.",
  },
  {
    pattern: /email.*not verified/i,
    message: "Adres email nie zostal zweryfikowany. Sprawdz skrzynke pocztowa.",
  },
  {
    pattern: /too many (requests|attempts)/i,
    message: "Zbyt wiele prob. Odczekaj chwile i sprobuj ponownie.",
  },
  {
    pattern: /session.*(expired|invalid)/i,
    message: "Sesja wygasla. Zaloguj sie ponownie.",
  },

  // Network errors
  {
    pattern: /failed to fetch|network|ECONNREFUSED|ENOTFOUND/i,
    message: "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie.",
  },
  {
    pattern: /timeout|timed? ?out|ETIMEDOUT/i,
    message: "Serwer nie odpowiedzial w wymaganym czasie. Sprobuj ponownie pozniej.",
  },

  // Stripe errors
  {
    pattern: /stripe|api.?key|sk_live|sk_test/i,
    message: "Problem z konfiguracja platnosci. Skontaktuj sie z administratorem.",
  },

  // AI/LLM errors
  {
    pattern: /openrouter|anthropic|rate.?limit|model|llm/i,
    message: "Usluga AI jest chwilowo niedostepna. Sprobuj ponownie za chwile.",
  },

  // VAPID/Push errors
  {
    pattern: /vapid|push|service.?worker|notification/i,
    message: "Nie udalo sie skonfigurowac powiadomien. Sprawdz ustawienia przegladarki.",
  },

  // Database errors
  {
    pattern: /database|sql|postgres|drizzle|unique constraint/i,
    message: "Wystapil problem z zapisem danych. Sprobuj ponownie.",
  },

  // File/storage errors
  {
    pattern: /file|upload|storage|blob/i,
    message: "Wystapil blad podczas przesylania pliku. Sprobuj ponownie.",
  },

  // Common English API error messages (from backend "Failed to..." patterns)
  {
    pattern: /failed to (fetch|load|get|retrieve|read)\s*(client|klient)/i,
    message: "Nie udalo sie pobrac danych klienta. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (create|add|insert)\s*(client|klient)/i,
    message: "Nie udalo sie dodac klienta. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (update|edit|modify)\s*(client|klient)/i,
    message: "Nie udalo sie zaktualizowac danych klienta. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (delete|remove)\s*(client|klient)/i,
    message: "Nie udalo sie usunac klienta. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve|read)\s*(employee|pracownik)/i,
    message: "Nie udalo sie pobrac danych pracownika. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (create|add|insert)\s*(employee|pracownik)/i,
    message: "Nie udalo sie dodac pracownika. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (update|edit|modify)\s*(employee|pracownik)/i,
    message: "Nie udalo sie zaktualizowac danych pracownika. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(service|uslug)/i,
    message: "Nie udalo sie pobrac danych uslugi. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(product|produkt)/i,
    message: "Nie udalo sie pobrac danych produktu. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(appointment|wizyt)/i,
    message: "Nie udalo sie pobrac danych wizyty. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(promotion|promocj)/i,
    message: "Nie udalo sie pobrac danych promocji. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(payment|platnosc)/i,
    message: "Nie udalo sie pobrac danych platnosci. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(report|raport)/i,
    message: "Nie udalo sie pobrac raportu. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(comparison|porownani)/i,
    message: "Nie udalo sie pobrac porownania. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (check|verify|validate)\s*(promotion|promocj|package|pakiet)/i,
    message: "Nie udalo sie sprawdzic promocji. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (cancel|anulowac)\s*(post|wpis)/i,
    message: "Nie udalo sie anulowac wpisu. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (publish|opublikowac)\s*(post|wpis)/i,
    message: "Nie udalo sie opublikowac wpisu. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (fetch|load|get|retrieve)\s*(scheduled|zaplanowany)/i,
    message: "Nie udalo sie pobrac zaplanowanych tresci. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (create|add|insert)\s*(scheduled|zaplanowany)/i,
    message: "Nie udalo sie zaplanowac tresci. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (update|save|record)/i,
    message: "Nie udalo sie zapisac zmian. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (delete|remove)/i,
    message: "Nie udalo sie usunac. Sprobuj ponownie.",
  },
  {
    pattern: /failed to (create|add|insert)/i,
    message: "Nie udalo sie utworzyc. Sprobuj ponownie.",
  },
  // Catch-all for any remaining "Failed to fetch/load" pattern
  {
    pattern: /failed to (fetch|load|get|retrieve)/i,
    message: "Nie udalo sie pobrac danych. Sprobuj ponownie pozniej.",
  },
  // Generic "Failed to" catch-all (lowest priority)
  {
    pattern: /failed to /i,
    message: "Operacja nie powiodla sie. Sprobuj ponownie pozniej.",
  },
  // English "Unknown error" catch
  {
    pattern: /^unknown error$/i,
    message: "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.",
  },
  // English "Internal server error" catch
  {
    pattern: /internal server error/i,
    message: "Wystapil blad serwera. Sprobuj ponownie pozniej.",
  },
  // Stripe cancellation failed
  {
    pattern: /stripe cancellation failed/i,
    message: "Nie udalo sie anulowac platnosci. Skontaktuj sie z obsluga.",
  },
];

/**
 * Convert a raw error into a user-friendly Polish message.
 *
 * @param error - The raw error (Error object, string, or unknown)
 * @param fallback - Optional custom fallback message (defaults to generic Polish message)
 * @returns A sanitized, user-friendly error message in Polish
 */
export function getUserFriendlyMessage(
  error: unknown,
  fallback = "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!rawMessage) return fallback;

  // Check against known patterns
  for (const { pattern, message } of ERROR_PATTERN_MAP) {
    if (pattern.test(rawMessage)) {
      return message;
    }
  }

  // If the message is short (< 100 chars), doesn't look technical, and is already
  // in a natural language format, it's probably safe to show
  const looksLikeTechnicalJargon =
    /^[A-Z][a-z]+Error:|^\[|^Error:|stack|at\s+\w+|\.tsx?:|\.jsx?:|node_modules|ECONNREFUSED|ENOTFOUND|undefined is not|cannot read prop|ERR_/i.test(
      rawMessage
    );

  if (rawMessage.length < 100 && !looksLikeTechnicalJargon) {
    return rawMessage;
  }

  return fallback;
}

/**
 * Sanitize an auth SDK error message.
 * Better Auth usually returns reasonably readable messages, but we map
 * known ones to Polish and catch any technical leaks.
 */
export function sanitizeAuthError(
  errorMessage: string | undefined,
  fallback = "Wystapil blad. Sprobuj ponownie."
): string {
  if (!errorMessage) return fallback;
  return getUserFriendlyMessage(errorMessage, fallback);
}

/**
 * Sanitize an API error message for display to the user.
 * Use this instead of directly showing `data.error` from API responses,
 * as backend errors may contain English or technical messages.
 *
 * @param apiError - The raw error string from API response (data.error)
 * @param fallback - Polish fallback message if apiError is empty
 * @returns A user-friendly Polish error message
 *
 * @example
 * // Instead of: toast.error(data.error || "Nie udalo sie...")
 * // Use: toast.error(sanitizeApiError(data.error, "Nie udalo sie..."))
 */
export function sanitizeApiError(
  apiError: string | undefined | null,
  fallback: string
): string {
  if (!apiError) return fallback;
  return getUserFriendlyMessage(apiError, fallback);
}

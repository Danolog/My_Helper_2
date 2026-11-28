/**
 * Jedyne miejsce wyboru modelu czatu: dostawca Google Vertex AI, model Gemini,
 * lokalizacja UE (`eu`) na stałe w kodzie.
 *
 * - Żaden inny plik pod `src/` nie importuje `@ai-sdk/google-vertex` i nie zna
 *   identyfikatora modelu (strażnik statyczny w `__tests__/lib/ai-model.test.ts`).
 * - Projekt chmury wyłącznie ze zmiennej `GOOGLE_VERTEX_PROJECT`. Lokalizacji kod
 *   nie czyta ze środowiska: adres usługi jest budowany tutaj, a SDK dostaje
 *   `location` i `project` jawnie, więc jego własny odczyt zmiennych nie zachodzi.
 * - Uwierzytelnienie: domyślne poświadczenia aplikacji (ADC), na Cloud Run konto
 *   usługi z serwera metadanych. Bez klucza w pliku: ustawione
 *   `GOOGLE_APPLICATION_CREDENTIALS` wyłącza AI, zamiast po cichu go użyć.
 * - Błędy dostawcy zamieniamy na odpowiedź z polskim tekstem (`aiErrorResponse`).
 *   Do logu idą tylko nazwa funkcji, salon, status HTTP i kod dostawcy — nigdy
 *   treść zapytania, odpowiedzi ani komunikat wyjątku (mogą zawierać dane osób).
 */

import { createVertex, type GoogleVertexProvider } from "@ai-sdk/google-vertex";
import { APICallError, RetryError, type FinishReason, type generateText } from "ai";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Model i adres usługi
// ────────────────────────────────────────────────────────────

/** Identyfikator modelu czatu w Vertex AI. */
export const CHAT_MODEL_ID = "gemini-3.8-flash";

/**
 * Lokalizacja wielu regionów UE. Na stałe: dane klientek salonu nie mogą wyjść
 * poza UE przez zmianę zmiennej środowiskowej.
 */
export const VERTEX_LOCATION = "eu";

/**
 * Host punktu końcowego dla lokalizacji `eu`. SDK w tej wersji dokleja nazwę
 * lokalizacji z przodu hosta regionalnego, co dla `eu` daje nieistniejący
 * adres, dlatego pełny `baseURL` podajemy sami.
 */
export const VERTEX_HOST = "aiplatform.eu.rep.googleapis.com";

/**
 * Format identyfikatora projektu GCP: 6–30 znaków, małe litery, cyfry i łącznik,
 * na początku litera, bez łącznika na końcu. Projekt trafia do ścieżki adresu,
 * więc wartość spoza formatu (np. z `/` albo `?`) odrzucamy przed budową adresu.
 */
const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Stały obiekt opcji uwierzytelnienia: SDK trzyma jedną instancję klienta ADC,
 * dopóki dostaje ten sam obiekt, więc token z serwera metadanych nie jest
 * pobierany przy każdym zapytaniu. Bez `credentials` i bez `keyFile`.
 */
const VERTEX_AUTH_OPTIONS = {
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
};

/** Model zwracany przez dostawcę Vertex (typ z SDK, bez zgadywania). */
export type ChatModel = ReturnType<GoogleVertexProvider>;

// ────────────────────────────────────────────────────────────
// Błędy konfiguracji
// ────────────────────────────────────────────────────────────

export type AIUnavailableReason =
  | "missing_project"
  | "invalid_project"
  | "key_file_credentials";

/**
 * Brak albo niedozwolona konfiguracja AI. Komunikat bez wartości zmiennych
 * (nazwa projektu nie trafia ani do odpowiedzi, ani do komunikatu wyjątku).
 */
export class AIUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE";

  constructor(readonly reason: AIUnavailableReason) {
    super(`AI is not configured (${reason})`);
    this.name = "AIUnavailableError";
  }
}

/** Odpowiedź modelu zablokowana przez filtr treści dostawcy. */
export class AIResponseBlockedError extends Error {
  readonly code = "AI_RESPONSE_BLOCKED";

  constructor() {
    super("AI response blocked by the provider content filter");
    this.name = "AIResponseBlockedError";
  }
}

/** Odpowiedź ucięta przez limit długości tam, gdzie trasa oczekuje pełnego JSON. */
export class AIResponseTruncatedError extends Error {
  readonly code = "AI_RESPONSE_TRUNCATED";

  constructor() {
    super("AI response truncated by the output token limit");
    this.name = "AIResponseTruncatedError";
  }
}

// ────────────────────────────────────────────────────────────
// getChatModel
// ────────────────────────────────────────────────────────────

/**
 * Model czatu dla wszystkich wywołań AI. Rzuca `AIUnavailableError`, zanim
 * cokolwiek wyjdzie do sieci, gdy:
 * - `GOOGLE_VERTEX_PROJECT` jest nieustawiona albo pusta (workflow wdrożenia daje
 *   pusty napis, gdy zmienna repo jest pusta),
 * - projekt nie ma formatu identyfikatora GCP,
 * - ustawiona jest zmienna z kluczem w pliku (ADC wybrałoby ją przed kontem usługi).
 */
export function getChatModel(): ChatModel {
  // Biblioteka uwierzytelnienia Google czyta obie pisownie tej zmiennej.
  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.google_application_credentials
  ) {
    throw new AIUnavailableError("key_file_credentials");
  }

  const project = process.env.GOOGLE_VERTEX_PROJECT;
  if (!project) {
    throw new AIUnavailableError("missing_project");
  }
  if (!GCP_PROJECT_ID_PATTERN.test(project)) {
    throw new AIUnavailableError("invalid_project");
  }

  const vertex = createVertex({
    project,
    location: VERTEX_LOCATION,
    baseURL: `https://${VERTEX_HOST}/v1/projects/${project}/locations/${VERTEX_LOCATION}/publishers/google`,
    googleAuthOptions: VERTEX_AUTH_OPTIONS,
  });
  return vertex(CHAT_MODEL_ID);
}

// ────────────────────────────────────────────────────────────
// Opcje wywołania
// ────────────────────────────────────────────────────────────

type CallProviderOptions = NonNullable<
  Parameters<typeof generateText>[0]["providerOptions"]
>;

/**
 * Niski poziom myślenia dla zwykłych pytań: tokeny myślenia liczą się jako
 * wyjście, więc wyższy poziom podnosi koszt i zjada `maxOutputTokens`.
 * `low`, nie `minimal` — `minimal` ten model odrzuca błędem walidacji.
 * Bez `temperature` i `topP`: wartości domyślne modelu wystarczają.
 */
export const CHAT_PROVIDER_OPTIONS = {
  google: {
    thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
  },
} as const satisfies CallProviderOptions;

/**
 * Opcje, które dostaje każde wywołanie modelu (`generateText`, `streamText`):
 * `{ model: getChatModel(), ...chatCallOptions(), ... }`. Zwraca świeżą kopię,
 * żeby żadne wywołanie nie zmieniło stałej dla innych.
 */
export function chatCallOptions(): { providerOptions: CallProviderOptions } {
  return {
    providerOptions: {
      google: {
        thinkingConfig: { ...CHAT_PROVIDER_OPTIONS.google.thinkingConfig },
      },
    },
  };
}

/**
 * Zamienia powód zakończenia na wyjątek tam, gdzie odpowiedź nie nadaje się
 * do użycia: filtr treści zawsze, ucięcie przez limit długości tylko wtedy,
 * gdy trasa oczekuje kompletnego JSON.
 */
export function assertUsableFinish(
  finishReason: FinishReason,
  options: { expectJson?: boolean } = {},
): void {
  if (finishReason === "content-filter") {
    throw new AIResponseBlockedError();
  }
  if (finishReason === "length" && options.expectJson) {
    throw new AIResponseTruncatedError();
  }
}

// ────────────────────────────────────────────────────────────
// Błędy dostawcy → odpowiedź HTTP
// ────────────────────────────────────────────────────────────

export const AI_ERROR_MESSAGES = {
  AI_UNAVAILABLE:
    "Asystent AI jest chwilowo niedostępny. Spróbuj ponownie później.",
  AI_PROVIDER_BUSY:
    "Asystent AI ma teraz zbyt wiele zapytań. Spróbuj ponownie za minutę.",
  AI_PROVIDER_ERROR: "Asystent AI nie odpowiedział. Spróbuj ponownie za chwilę.",
  AI_RESPONSE_BLOCKED:
    "Asystent nie może odpowiedzieć na to pytanie. Spróbuj zapytać inaczej.",
} as const;

export type AIErrorCode = keyof typeof AI_ERROR_MESSAGES;

const AI_ERROR_STATUS: Record<AIErrorCode, number> = {
  AI_UNAVAILABLE: 503,
  AI_PROVIDER_BUSY: 503,
  AI_PROVIDER_ERROR: 502,
  AI_RESPONSE_BLOCKED: 422,
};

/** Po ilu sekundach klient może ponowić zapytanie przy limicie dostawcy. */
const PROVIDER_BUSY_RETRY_AFTER_SEC = 60;

/** Statusy dostawcy oznaczające brak dostępu albo brak modelu (rola IAM, lokalizacja). */
const PROVIDER_ACCESS_STATUSES = new Set([401, 403, 404]);

/**
 * Znacznik błędów `gaxios` (klient HTTP biblioteki uwierzytelnienia Google).
 * Symbol z globalnego rejestru, więc działa niezależnie od kopii paczki.
 */
const GAXIOS_ERROR_SYMBOL = Symbol.for("gaxios-gaxios-error");

/**
 * Początki komunikatów, którymi biblioteka uwierzytelnienia Google zgłasza brak
 * poświadczeń ADC (błędy bez kodu HTTP, rzucane przed wysłaniem zapytania).
 */
const ADC_ERROR_PREFIXES = [
  "Could not load the default credentials",
  "Could not refresh access token",
  "Unable to detect a Project Id",
];

/** Błąd uwierzytelnienia ADC — pojawia się dopiero przy wywołaniu modelu. */
function isAuthLibraryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (GAXIOS_ERROR_SYMBOL in error) return true;
  return ADC_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix));
}

/** Kod stanu Google (np. `RESOURCE_EXHAUSTED`) z treści błędu, bez komunikatu. */
function providerErrorStatus(error: APICallError): string | undefined {
  const data = error.data as { error?: { status?: unknown } } | undefined;
  const status = data?.error?.status;
  return typeof status === "string" ? status.slice(0, 64) : undefined;
}

export type AIErrorClassification = {
  code: AIErrorCode;
  /** Status HTTP od dostawcy, jeśli zapytanie do niego doszło. */
  providerStatus?: number | undefined;
  /** Kod stanu Google z treści błędu (np. `RESOURCE_EXHAUSTED`). */
  providerErrorStatus?: string | undefined;
  /** Nazwa klasy błędu — do logu zamiast komunikatu. */
  errorName: string;
};

/**
 * Przypisuje błąd do jednego z kodów z tabeli. Wyjątek po ponowieniach
 * (`RetryError`) oceniamy po ostatnim błędzie. Nieznany błąd to błąd dostawcy
 * (502), nigdy „niedostępny” — żeby awaria sieci nie wyglądała na brak konfiguracji.
 */
export function classifyAIError(error: unknown): AIErrorClassification {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  const errorName = inner instanceof Error ? inner.name : typeof inner;

  if (inner instanceof AIUnavailableError || isAuthLibraryError(inner)) {
    return { code: "AI_UNAVAILABLE", errorName };
  }
  if (inner instanceof AIResponseBlockedError) {
    return { code: "AI_RESPONSE_BLOCKED", errorName };
  }
  if (APICallError.isInstance(inner)) {
    const providerStatus = inner.statusCode;
    const googleStatus = providerErrorStatus(inner);
    const details = { providerStatus, providerErrorStatus: googleStatus, errorName };
    if (providerStatus === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
      return { code: "AI_PROVIDER_BUSY", ...details };
    }
    if (providerStatus !== undefined && PROVIDER_ACCESS_STATUSES.has(providerStatus)) {
      return { code: "AI_UNAVAILABLE", ...details };
    }
    return { code: "AI_PROVIDER_ERROR", ...details };
  }
  return { code: "AI_PROVIDER_ERROR", errorName };
}

/**
 * Odpowiedź HTTP dla błędu wywołania modelu: polski tekst i kod z tabeli,
 * przy limicie dostawcy nagłówek `Retry-After`. Ciało nigdy nie zawiera
 * komunikatu wyjątku ani konfiguracji.
 *
 * @param context.feature - nazwa funkcji AI (do logu)
 * @param context.salonId - salon, dla którego szło zapytanie (do logu)
 */
export function aiErrorResponse(
  error: unknown,
  context: { feature?: string; salonId?: string } = {},
): Response {
  const classification = classifyAIError(error);
  const { code } = classification;

  logger.warn("[AI] Model call failed", {
    feature: context.feature,
    salonId: context.salonId,
    code,
    errorName: classification.errorName,
    providerStatus: classification.providerStatus,
    providerErrorStatus: classification.providerErrorStatus,
    reason: error instanceof AIUnavailableError ? error.reason : undefined,
  });

  const headers: Record<string, string> =
    code === "AI_PROVIDER_BUSY"
      ? { "Retry-After": String(PROVIDER_BUSY_RETRY_AFTER_SEC) }
      : {};
  return Response.json(
    { error: AI_ERROR_MESSAGES[code], code },
    { status: AI_ERROR_STATUS[code], headers },
  );
}

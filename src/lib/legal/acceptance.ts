/**
 * Akceptacja regulaminu i umowy powierzenia (DPA) przy zakładaniu salonu.
 *
 * Reguła serwera (trasa zakładająca salon):
 * - dopóki dokumenty nie są opublikowane (`LEGAL_DOCS_PUBLISHED = false`), akceptacja
 *   nie obowiązuje: nie ma treści ani wersji, którą konto mogłoby zaakceptować, więc
 *   rejestracja działa jak dotąd i nic nie jest zapisywane;
 * - po publikacji obie wersje (regulamin i DPA, osobne pola) muszą być równe bieżącym
 *   wersjom z rejestru dokumentów — inaczej trasa odpowiada 400 i nie zakłada salonu;
 * - flaga włączona przy dokumencie bez wersji to błąd konfiguracji: rejestracja jest
 *   wtedy zablokowana (wyjątek → 500), a nie przepuszczana bez dowodu akceptacji.
 *
 * Moduł nie otwiera transakcji i nie importuje `@/lib/db`; zapis biegnie w transakcji
 * wołającego, razem z założeniem salonu.
 */
import { LEGAL_DOCS_PUBLISHED, LEGAL_DOCUMENTS, type LegalDocuments } from "@/lib/legal/documents";
import { legalAcceptances, type LEGAL_ACCEPTANCE_SOURCES } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

export type LegalAcceptanceSource = (typeof LEGAL_ACCEPTANCE_SOURCES)[number];

/**
 * Źródła, które może podać formularz. `email_pilot` (akceptacja e-mailem) nie
 * przychodzi z trasy — taki wpis dodaje się poza ścieżką żądania.
 */
export type FormLegalAcceptanceSource = Exclude<LegalAcceptanceSource, "email_pilot">;

/** Bieżące wersje dokumentów, które konto musi zaakceptować. */
export type RequiredLegalVersions = { readonly terms: string; readonly dpa: string };

/** Pola akceptacji z treści żądania (po walidacji schematu). */
export type LegalAcceptanceInput = {
  termsVersion?: string | undefined;
  dpaVersion?: string | undefined;
  acceptanceSource?: FormLegalAcceptanceSource | undefined;
};

/** Akceptacja gotowa do zapisu. */
export type AcceptedLegalDocuments = {
  readonly versions: RequiredLegalVersions;
  readonly source: FormLegalAcceptanceSource;
};

export const LEGAL_ACCEPTANCE_REQUIRED_CODE = "LEGAL_ACCEPTANCE_REQUIRED";

export type LegalAcceptanceErrorBody = {
  success: false;
  code: typeof LEGAL_ACCEPTANCE_REQUIRED_CODE;
  error: string;
  details: Record<string, string>;
  requiredVersions: RequiredLegalVersions;
};

export type LegalAcceptanceCheck =
  /** `acceptance: null` = akceptacja jeszcze nie obowiązuje, nic do zapisu. */
  | { ok: true; acceptance: AcceptedLegalDocuments | null }
  | { ok: false; body: LegalAcceptanceErrorBody };

/** Flaga publikacji włączona, a regulamin albo DPA bez wersji. */
export class LegalDocumentsConfigError extends Error {
  constructor(document: "terms" | "dpa") {
    super(`Dokumenty prawne opublikowane bez wersji dokumentu: ${document}`);
    this.name = "LegalDocumentsConfigError";
  }
}

/**
 * Wersje wymagane przy zakładaniu salonu; `null`, dopóki dokumenty nie są opublikowane.
 * Parametry istnieją, żeby test sprawdzał regułę przy obu wartościach flagi bez atrapy modułu.
 *
 * @throws LegalDocumentsConfigError gdy flaga jest włączona, a regulamin albo DPA nie ma wersji.
 */
export function requiredLegalVersions(
  published: boolean = LEGAL_DOCS_PUBLISHED,
  documents: LegalDocuments = LEGAL_DOCUMENTS,
): RequiredLegalVersions | null {
  if (!published) return null;
  const terms = documents.terms.version;
  const dpa = documents.dpa.version;
  if (terms === null) throw new LegalDocumentsConfigError("terms");
  if (dpa === null) throw new LegalDocumentsConfigError("dpa");
  return { terms, dpa };
}

/**
 * Sprawdza akceptację z treści żądania względem wymaganych wersji. Wersja inna niż
 * bieżąca (np. formularz otwarty przed zmianą dokumentu) liczy się jak brak akceptacji.
 */
export function checkLegalAcceptance(
  input: LegalAcceptanceInput,
  required: RequiredLegalVersions | null,
): LegalAcceptanceCheck {
  if (required === null) return { ok: true, acceptance: null };

  const source = input.acceptanceSource;
  const details: Record<string, string> = {};
  if (input.termsVersion !== required.terms) {
    details.termsVersion = "Zaakceptuj aktualny regulamin";
  }
  if (input.dpaVersion !== required.dpa) {
    details.dpaVersion = "Zaakceptuj aktualna umowe powierzenia przetwarzania danych";
  }
  if (source === undefined) {
    details.acceptanceSource = "Brak zrodla akceptacji";
  }
  if (source === undefined || Object.keys(details).length > 0) {
    return {
      ok: false,
      body: {
        success: false,
        code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
        error: "Aby zalozyc salon, zaakceptuj aktualny regulamin i umowe powierzenia przetwarzania danych.",
        details,
        requiredVersions: required,
      },
    };
  }
  return { ok: true, acceptance: { versions: required, source } };
}

/**
 * Dopisuje dwa wpisy (regulamin i DPA) do `legal_acceptances`.
 *
 * - Wołać w TEJ SAMEJ transakcji co założenie salonu: błąd zapisu cofa salon,
 *   a cofnięcie salonu cofa wpisy.
 * - `salonId` z wiersza salonu w transakcji, `userId` z sesji — nigdy z treści żądania.
 * - Czas akceptacji nadaje baza (`now()` = czas transakcji, ten sam dla obu wpisów).
 */
export async function recordLegalAcceptances(
  tx: DbTx,
  input: { salonId: string; userId: string; acceptance: AcceptedLegalDocuments },
): Promise<void> {
  const { salonId, userId, acceptance } = input;
  await tx.insert(legalAcceptances).values([
    { salonId, userId, document: "terms", version: acceptance.versions.terms, source: acceptance.source },
    { salonId, userId, document: "dpa", version: acceptance.versions.dpa, source: acceptance.source },
  ]);
}

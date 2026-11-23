/**
 * Dokumenty prawne serwisu: adresy stron, wersje treści i flaga publikacji.
 *
 * Moduł bez importów — bezpieczny dla klienta i serwera (stopka, strony
 * dokumentów).
 *
 * Dopóki dokument nie jest opublikowany, jego strona odpowiada 404, a stopka
 * do niej nie linkuje. Scalenie zmian oznacza wdrożenie, więc strona nie może
 * pokazać zdania, które w dniu wdrożenia nie jest jeszcze prawdziwe.
 */

/**
 * Jedna flaga dla wszystkich stron prawnych (także kontaktu). Zmiana na `true`
 * wymaga recenzji bezpieczeństwa i zgody właściciela produktu na treść
 * wszystkich dokumentów.
 */
export const LEGAL_DOCS_PUBLISHED: boolean = false;

export type LegalDocumentKey =
  | "privacy"
  | "terms"
  | "dpa"
  | "subprocessors"
  | "contact";

export type LegalDocument = {
  /** Adres strony dokumentu. */
  readonly href: string;
  /** Tytuł strony i etykieta odnośnika w stopce. */
  readonly title: string;
  /**
   * Czy dokument ma wersję treści. Akceptuje się tylko wersjonowany tekst,
   * więc taki dokument bez wersji nie jest gotowy do publikacji.
   */
  readonly requiresVersion: boolean;
  /** Wersja treści (np. data). `null` = treść jeszcze nie ustalona. */
  readonly version: string | null;
};

export type LegalDocuments = Readonly<Record<LegalDocumentKey, LegalDocument>>;

export const LEGAL_DOCUMENTS: LegalDocuments = {
  privacy: {
    href: "/privacy",
    title: "Polityka prywatności",
    requiresVersion: true,
    version: null,
  },
  terms: {
    href: "/terms",
    title: "Regulamin",
    requiresVersion: true,
    version: null,
  },
  dpa: {
    href: "/dpa",
    title: "Umowa powierzenia przetwarzania danych",
    requiresVersion: true,
    version: null,
  },
  subprocessors: {
    href: "/podprocesorzy",
    title: "Podprocesorzy",
    requiresVersion: false,
    version: null,
  },
  contact: {
    href: "/contact",
    title: "Kontakt",
    requiresVersion: false,
    version: null,
  },
};

/** Kolejność odnośników w stopce. */
export const LEGAL_DOCUMENT_KEYS: readonly LegalDocumentKey[] = [
  "privacy",
  "terms",
  "dpa",
  "subprocessors",
  "contact",
];

export type LegalLink = {
  readonly key: LegalDocumentKey;
  readonly href: string;
  readonly title: string;
};

/**
 * Czy strona dokumentu jest opublikowana. Stan (flaga i rejestr) przychodzi
 * domyślnie z tego modułu; parametry istnieją, żeby test sprawdzał regułę
 * przy obu wartościach flagi bez atrapy modułu.
 */
export function isLegalPagePublished(
  key: LegalDocumentKey,
  published: boolean = LEGAL_DOCS_PUBLISHED,
  documents: LegalDocuments = LEGAL_DOCUMENTS,
): boolean {
  if (!published) return false;
  const document = documents[key];
  return !document.requiresVersion || document.version !== null;
}

/** Odnośniki do opublikowanych dokumentów; przy wyłączonej fladze pusta lista. */
export function publishedLegalLinks(
  published: boolean = LEGAL_DOCS_PUBLISHED,
  documents: LegalDocuments = LEGAL_DOCUMENTS,
): LegalLink[] {
  return LEGAL_DOCUMENT_KEYS.filter((key) =>
    isLegalPagePublished(key, published, documents),
  ).map((key) => ({
    key,
    href: documents[key].href,
    title: documents[key].title,
  }));
}

// ---------------------------------------------------------------------------
// Akceptacja przy zakładaniu salonu i informacja przy rezerwacji gościa (UI)
// ---------------------------------------------------------------------------

/**
 * Kod odpowiedzi 400 trasy zakładającej salon przy braku akceptacji. Stała jest
 * tutaj, a nie w module serwera, żeby formularz w przeglądarce nie importował
 * schematu bazy.
 */
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = "LEGAL_ACCEPTANCE_REQUIRED";

/** Miejsce, z którego formularz wysyła akceptację (etykieta deklarowana przez klienta). */
export type LegalAcceptanceFormSource = "registration" | "create_salon";

/** Dokument do zaakceptowania w formularzu: odnośnik i wersja, którą formularz wyśle. */
export type AcceptableLegalDocument = LegalLink & { readonly version: string };

/** Pola akceptacji w formularzu: regulamin i DPA, każdy osobno. */
export type LegalAcceptanceForm = {
  readonly terms: AcceptableLegalDocument;
  readonly dpa: AcceptableLegalDocument;
};

/** Zaznaczenia w formularzu, osobno dla każdego dokumentu. */
export type LegalAcceptanceChecks = { readonly terms: boolean; readonly dpa: boolean };

/** Pola treści żądania zakładającego salon (pusty obiekt, gdy nie ma czego wysłać). */
export type LegalAcceptanceRequestFields =
  | Record<string, never>
  | {
      termsVersion: string;
      dpaVersion: string;
      acceptanceSource: LegalAcceptanceFormSource;
    };

function acceptableDocument(
  key: "terms" | "dpa",
  published: boolean,
  documents: LegalDocuments,
): AcceptableLegalDocument | null {
  const document = documents[key];
  if (!isLegalPagePublished(key, published, documents) || document.version === null) {
    return null;
  }
  return { key, href: document.href, title: document.title, version: document.version };
}

/**
 * Pola akceptacji regulaminu i DPA przy zakładaniu salonu (rejestracja i panel).
 *
 * Zwraca `null`, dopóki strona regulaminu albo DPA nie jest opublikowana: formularz
 * nie pokazuje wtedy pól ani odnośników do stron, które odpowiadają 404, a trasa
 * akceptacji nie wymaga. Flaga włączona przy dokumencie bez wersji też daje `null`:
 * trasa odpowiada wtedy 500 (błąd konfiguracji), a formularz pokazuje ten błąd.
 */
export function legalAcceptanceForm(
  published: boolean = LEGAL_DOCS_PUBLISHED,
  documents: LegalDocuments = LEGAL_DOCUMENTS,
): LegalAcceptanceForm | null {
  const terms = acceptableDocument("terms", published, documents);
  const dpa = acceptableDocument("dpa", published, documents);
  if (terms === null || dpa === null) return null;
  return { terms, dpa };
}

/** Czy formularz może wysłać żądanie: bez pól zawsze, z polami po zaznaczeniu obu. */
export function isLegalAcceptanceComplete(
  form: LegalAcceptanceForm | null,
  checks: LegalAcceptanceChecks,
): boolean {
  return form === null || (checks.terms && checks.dpa);
}

/**
 * Pola akceptacji do treści żądania. Wersje pochodzą z rejestru dokumentów (tego
 * samego, który sprawdza trasa), nigdy z literałów w komponencie. Bez pól albo bez
 * obu zaznaczeń: pusty obiekt (po publikacji trasa odpowie wtedy 400).
 */
export function legalAcceptanceRequestFields(
  form: LegalAcceptanceForm | null,
  checks: LegalAcceptanceChecks,
  source: LegalAcceptanceFormSource,
): LegalAcceptanceRequestFields {
  if (form === null || !checks.terms || !checks.dpa) return {};
  return {
    termsVersion: form.terms.version,
    dpaVersion: form.dpa.version,
    acceptanceSource: source,
  };
}

/** Odnośniki w informacji przy rezerwacji gościa. */
export type BookingLegalNotice = {
  readonly terms: LegalLink;
  readonly privacy: LegalLink;
};

/**
 * Informacja przy rezerwacji gościa (regulamin i polityka prywatności).
 * `null`, dopóki któraś z tych stron nie jest opublikowana: nie ma wtedy zdania
 * ani odnośników do stron 404.
 */
export function bookingLegalNotice(
  published: boolean = LEGAL_DOCS_PUBLISHED,
  documents: LegalDocuments = LEGAL_DOCUMENTS,
): BookingLegalNotice | null {
  if (
    !isLegalPagePublished("terms", published, documents) ||
    !isLegalPagePublished("privacy", published, documents)
  ) {
    return null;
  }
  const link = (key: "terms" | "privacy"): LegalLink => ({
    key,
    href: documents[key].href,
    title: documents[key].title,
  });
  return { terms: link("terms"), privacy: link("privacy") };
}

/**
 * Komunikat dla użytkownika, gdy trasa zakładająca salon odrzuci akceptację
 * (np. dokument zmienił się, gdy formularz był otwarty).
 */
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  "Zaakceptuj aktualny regulamin i umowę powierzenia przetwarzania danych. Jeśli dokumenty zmieniły się w trakcie, odśwież stronę.";

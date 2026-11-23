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

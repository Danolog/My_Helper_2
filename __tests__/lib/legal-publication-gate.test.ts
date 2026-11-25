/**
 * Bramka publikacji dokumentów prawnych.
 *
 * Część 1 sprawdza prawdziwy rejestr i prawdziwą treść. Pełna reguła działa
 * tylko przy włączonej fladze `LEGAL_DOCS_PUBLISHED`: wtedy test pada, gdy
 * dokument wymagający wersji nie ma wersji ostatecznej, gdy treść jest pusta
 * albo gdy zostały w niej znaczniki do uzupełnienia. Dopóki flaga jest
 * wyłączona, test sprawdza tylko, że treść każdego dokumentu istnieje.
 *
 * Część 2 sprawdza samą regułę na danych z parametru (bez atrapy modułu),
 * przypadkami pozytywnymi i negatywnymi.
 */
import { describe, it, expect } from "vitest";
import { LEGAL_CONTENT, type LegalContent } from "@/lib/legal/content";
import {
  LEGAL_DOCS_PUBLISHED,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  type LegalDocuments,
} from "@/lib/legal/documents";
import {
  countLegalPlaceholders,
  legalPublicationProblems,
} from "@/lib/legal/publication";

const FINAL_VERSION = "2026-12-01";

const VERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: FINAL_VERSION },
  terms: { ...LEGAL_DOCUMENTS.terms, version: FINAL_VERSION },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: FINAL_VERSION },
};

const READY_CONTENT: LegalContent = {
  privacy: "## 1. Administrator\n\nTreść polityki.",
  terms: "## 1. Kim jesteśmy\n\nTreść regulaminu.",
  dpa: "## § 1. Strony\n\nTreść umowy.",
  subprocessors: "| Firma | Po co |\n|---|---|\n| Dostawca | serwery |",
  contact: "**E-mail: kontakt@nordsignal.cc**",
};

describe("dokumenty w module", () => {
  it.runIf(LEGAL_DOCS_PUBLISHED)(
    "flaga włączona: wersje ostateczne, treść bez znaczników do uzupełnienia",
    () => {
      expect(legalPublicationProblems()).toEqual([]);
    },
  );

  it.skipIf(LEGAL_DOCS_PUBLISHED)("flaga wyłączona: treść każdego dokumentu istnieje", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(LEGAL_CONTENT[key].trim(), key).not.toBe("");
    }
  });
});

describe("legalPublicationProblems (dane z parametru)", () => {
  it("gotowe dokumenty: brak problemów", () => {
    expect(legalPublicationProblems(VERSIONED, READY_CONTENT)).toEqual([]);
  });

  it("dokument bez wymogu wersji może mieć wersję null", () => {
    expect(VERSIONED.subprocessors.version).toBeNull();
    expect(VERSIONED.contact.version).toBeNull();
    expect(legalPublicationProblems(VERSIONED, READY_CONTENT)).toEqual([]);
  });

  it("wersja null w dokumencie wymagającym wersji blokuje publikację", () => {
    const documents: LegalDocuments = {
      ...VERSIONED,
      terms: { ...VERSIONED.terms, version: null },
    };
    expect(legalPublicationProblems(documents, READY_CONTENT)).toEqual([
      { key: "terms", reason: "missing_version" },
    ]);
  });

  it("wersja robocza (sufiks -draft) blokuje publikację", () => {
    const documents: LegalDocuments = {
      ...VERSIONED,
      dpa: { ...VERSIONED.dpa, version: "2026-11-26-draft" },
    };
    expect(legalPublicationProblems(documents, READY_CONTENT)).toEqual([
      { key: "dpa", reason: "draft_version", version: "2026-11-26-draft" },
    ]);
  });

  it("wersja ze słowem draft w środku nie jest wersją roboczą", () => {
    const documents: LegalDocuments = {
      ...VERSIONED,
      privacy: { ...VERSIONED.privacy, version: "draft-2026-12-01" },
    };
    expect(legalPublicationProblems(documents, READY_CONTENT)).toEqual([]);
  });

  it("pusta treść (także same białe znaki) blokuje publikację", () => {
    const content: LegalContent = { ...READY_CONTENT, contact: "", subprocessors: " \n\t" };
    expect(legalPublicationProblems(VERSIONED, content)).toEqual([
      { key: "subprocessors", reason: "empty_content" },
      { key: "contact", reason: "empty_content" },
    ]);
  });

  it("znacznik do uzupełnienia blokuje publikację, z liczbą znaczników", () => {
    const content: LegalContent = {
      ...READY_CONTENT,
      privacy: "Administrator: [DO UZUPEŁNIENIA: nazwa], NIP [DO UZUPEŁNIENIA: NIP].",
    };
    expect(legalPublicationProblems(VERSIONED, content)).toEqual([
      { key: "privacy", reason: "placeholders", count: 2 },
    ]);
  });

  it("problemy z kilku dokumentów zbierane razem, w kolejności rejestru", () => {
    const content: LegalContent = {
      ...READY_CONTENT,
      contact: "[DO UZUPEŁNIENIA: adres]",
    };
    expect(legalPublicationProblems(LEGAL_DOCUMENTS, content)).toEqual([
      { key: "privacy", reason: "missing_version" },
      { key: "terms", reason: "missing_version" },
      { key: "dpa", reason: "missing_version" },
      { key: "contact", reason: "placeholders", count: 1 },
    ]);
  });

  it("obecny rejestr i treść nie są gotowe do publikacji", () => {
    const problems = legalPublicationProblems(LEGAL_DOCUMENTS, LEGAL_CONTENT);
    expect(problems.length).toBeGreaterThan(0);
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(problems, key).toContainEqual(
        expect.objectContaining({ key, reason: "placeholders" }),
      );
    }
  });
});

describe("countLegalPlaceholders", () => {
  it("liczy znaczniki, a nie zwykłe nawiasy kwadratowe", () => {
    expect(countLegalPlaceholders("")).toBe(0);
    expect(countLegalPlaceholders("[konto salonu / konto klienta](*)")).toBe(0);
    expect(countLegalPlaceholders("[DO UZUPEŁNIENIA: a] i [DO UZUPEŁNIENIA: b]")).toBe(2);
  });
});

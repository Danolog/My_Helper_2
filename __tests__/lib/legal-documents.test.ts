/**
 * Rejestr dokumentów prawnych i reguła publikacji.
 *
 * Funkcje przyjmują stan (flagę i rejestr) jako parametry z wartościami
 * domyślnymi z modułu. Każdy przypadek podaje flagę jawnie, więc wynik nie
 * zależy od wartości flagi w module; osobno test sprawdza, że wartości
 * domyślne to flaga i rejestr z modułu, oraz realny stan rejestru i treści.
 */
import { describe, it, expect } from "vitest";
import {
  LEGAL_DOCS_PUBLISHED,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  isLegalPagePublished,
  publishedLegalLinks,
  type LegalDocuments,
} from "@/lib/legal/documents";
import {
  LEGAL_DRAFT_VERSION_SUFFIX,
  legalPublicationProblems,
} from "@/lib/legal/publication";

const VERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
};

const UNVERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: null },
  terms: { ...LEGAL_DOCUMENTS.terms, version: null },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: null },
};

describe("wartości w module", () => {
  it("wartości domyślne funkcji to flaga i rejestr z modułu", () => {
    expect(typeof LEGAL_DOCS_PUBLISHED).toBe("boolean");
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(isLegalPagePublished(key)).toBe(
        isLegalPagePublished(key, LEGAL_DOCS_PUBLISHED, LEGAL_DOCUMENTS),
      );
    }
    expect(publishedLegalLinks()).toEqual(
      publishedLegalLinks(LEGAL_DOCS_PUBLISHED, LEGAL_DOCUMENTS),
    );
  });

  it("flaga wyłączona przy rejestrze z modułu: żadna strona nie jest opublikowana, a stopka dostaje pustą listę", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(isLegalPagePublished(key, false, LEGAL_DOCUMENTS)).toBe(false);
    }
    expect(publishedLegalLinks(false, LEGAL_DOCUMENTS)).toEqual([]);
  });

  it("polityka, regulamin i umowa powierzenia mają wersje ostateczne (data, bez sufiksu roboczego)", () => {
    for (const key of ["privacy", "terms", "dpa"] as const) {
      const { version } = LEGAL_DOCUMENTS[key];
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(version?.endsWith(LEGAL_DRAFT_VERSION_SUFFIX)).toBe(false);
    }
  });

  it("rejestr i treść gotowe do publikacji: bez braków wersji, pustej treści i znaczników", () => {
    expect(legalPublicationProblems()).toEqual([]);
  });

  it("rejestr ma pięć stron pod ustalonymi adresami", () => {
    expect(LEGAL_DOCUMENT_KEYS.map((key) => LEGAL_DOCUMENTS[key].href)).toEqual([
      "/privacy",
      "/terms",
      "/dpa",
      "/podprocesorzy",
      "/contact",
    ]);
  });

  it("wersję wymagają tylko polityka, regulamin i umowa powierzenia", () => {
    const versioned = LEGAL_DOCUMENT_KEYS.filter(
      (key) => LEGAL_DOCUMENTS[key].requiresVersion,
    );
    expect(versioned).toEqual(["privacy", "terms", "dpa"]);
  });
});

describe("isLegalPagePublished", () => {
  it("flaga wyłączona: nieopublikowana nawet z wersją", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(isLegalPagePublished(key, false, VERSIONED)).toBe(false);
    }
  });

  it("flaga włączona, wersja null: polityka, regulamin i umowa nieopublikowane", () => {
    expect(isLegalPagePublished("privacy", true, UNVERSIONED)).toBe(false);
    expect(isLegalPagePublished("terms", true, UNVERSIONED)).toBe(false);
    expect(isLegalPagePublished("dpa", true, UNVERSIONED)).toBe(false);
  });

  it("flaga włączona: strony bez wersji (podprocesorzy, kontakt) opublikowane", () => {
    expect(isLegalPagePublished("subprocessors", true, UNVERSIONED)).toBe(true);
    expect(isLegalPagePublished("contact", true, UNVERSIONED)).toBe(true);
  });

  it("flaga włączona i wersje ustawione: wszystkie opublikowane", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(isLegalPagePublished(key, true, VERSIONED)).toBe(true);
    }
  });
});

describe("publishedLegalLinks", () => {
  it("flaga wyłączona: pusta lista także przy ustawionych wersjach", () => {
    expect(publishedLegalLinks(false, VERSIONED)).toEqual([]);
  });

  it("flaga włączona bez wersji: tylko strony, które wersji nie wymagają", () => {
    expect(publishedLegalLinks(true, UNVERSIONED).map((l) => l.key)).toEqual([
      "subprocessors",
      "contact",
    ]);
  });

  it("flaga włączona z wersjami: wszystkie w kolejności stopki, z adresem i tytułem", () => {
    expect(publishedLegalLinks(true, VERSIONED)).toEqual(
      LEGAL_DOCUMENT_KEYS.map((key) => ({
        key,
        href: LEGAL_DOCUMENTS[key].href,
        title: LEGAL_DOCUMENTS[key].title,
      })),
    );
  });
});

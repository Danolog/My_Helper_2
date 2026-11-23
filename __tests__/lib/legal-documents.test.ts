/**
 * Rejestr dokumentów prawnych i reguła publikacji.
 *
 * Funkcje przyjmują stan (flagę i rejestr) jako parametry z wartościami
 * domyślnymi z modułu. Dzięki temu test sprawdza prawdziwą regułę przy obu
 * wartościach flagi, a osobno — że wartość w module jest wyłączona.
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

const VERSIONED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
};

describe("wartości w module", () => {
  it("flaga publikacji jest wyłączona", () => {
    expect(LEGAL_DOCS_PUBLISHED).toBe(false);
  });

  it("żadna strona nie jest opublikowana, a stopka dostaje pustą listę", () => {
    for (const key of LEGAL_DOCUMENT_KEYS) {
      expect(isLegalPagePublished(key)).toBe(false);
    }
    expect(publishedLegalLinks()).toEqual([]);
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
    expect(isLegalPagePublished("privacy", true, LEGAL_DOCUMENTS)).toBe(false);
    expect(isLegalPagePublished("terms", true, LEGAL_DOCUMENTS)).toBe(false);
    expect(isLegalPagePublished("dpa", true, LEGAL_DOCUMENTS)).toBe(false);
  });

  it("flaga włączona: strony bez wersji (podprocesorzy, kontakt) opublikowane", () => {
    expect(isLegalPagePublished("subprocessors", true, LEGAL_DOCUMENTS)).toBe(true);
    expect(isLegalPagePublished("contact", true, LEGAL_DOCUMENTS)).toBe(true);
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
    expect(publishedLegalLinks(true, LEGAL_DOCUMENTS).map((l) => l.key)).toEqual([
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

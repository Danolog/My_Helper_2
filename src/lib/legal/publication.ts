/**
 * Gotowość dokumentów prawnych do publikacji.
 *
 * Reguła, którą test bramki sprawdza przed włączeniem `LEGAL_DOCS_PUBLISHED`:
 * każdy dokument wymagający wersji ma wersję ostateczną (nie `null` i bez
 * sufiksu `-draft`), a treść każdego dokumentu jest niepusta i nie zawiera
 * znaczników do uzupełnienia. Stan przychodzi domyślnie z modułów rejestru
 * i treści; parametry pozwalają sprawdzić regułę na dowolnych danych.
 */
import { LEGAL_CONTENT, type LegalContent } from "@/lib/legal/content";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  type LegalDocumentKey,
  type LegalDocuments,
} from "@/lib/legal/documents";

/** Początek znacznika miejsca, które musi wypełnić właściciel produktu. */
export const LEGAL_PLACEHOLDER_MARKER = "[DO UZUPEŁNIENIA";

/** Sufiks wersji roboczej; taka wersja nie może trafić do akceptacji. */
export const LEGAL_DRAFT_VERSION_SUFFIX = "-draft";

export type LegalPublicationProblem =
  | { readonly key: LegalDocumentKey; readonly reason: "missing_version" }
  | { readonly key: LegalDocumentKey; readonly reason: "draft_version"; readonly version: string }
  | { readonly key: LegalDocumentKey; readonly reason: "empty_content" }
  | { readonly key: LegalDocumentKey; readonly reason: "placeholders"; readonly count: number };

/** Liczba znaczników `[DO UZUPEŁNIENIA` w tekście. */
export function countLegalPlaceholders(text: string): number {
  return text.split(LEGAL_PLACEHOLDER_MARKER).length - 1;
}

/** Problemy blokujące publikację; pusta lista = dokumenty gotowe. */
export function legalPublicationProblems(
  documents: LegalDocuments = LEGAL_DOCUMENTS,
  content: LegalContent = LEGAL_CONTENT,
): LegalPublicationProblem[] {
  const problems: LegalPublicationProblem[] = [];
  for (const key of LEGAL_DOCUMENT_KEYS) {
    const { requiresVersion, version } = documents[key];
    if (requiresVersion && version === null) {
      problems.push({ key, reason: "missing_version" });
    } else if (requiresVersion && version !== null && version.endsWith(LEGAL_DRAFT_VERSION_SUFFIX)) {
      problems.push({ key, reason: "draft_version", version });
    }

    const text = content[key];
    if (text.trim() === "") {
      problems.push({ key, reason: "empty_content" });
    }
    const count = countLegalPlaceholders(text);
    if (count > 0) {
      problems.push({ key, reason: "placeholders", count });
    }
  }
  return problems;
}

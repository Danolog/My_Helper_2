import { notFound } from "next/navigation";
import { LegalContent } from "@/components/legal/legal-content";
import { LEGAL_CONTENT } from "@/lib/legal/content";
import {
  LEGAL_DOCUMENTS,
  isLegalPagePublished,
  type LegalDocumentKey,
} from "@/lib/legal/documents";
import { parseLegalMarkdown } from "@/lib/legal/markdown";
import type { Metadata } from "next";

/**
 * Metadane strony dokumentu prawnego. Strona nieopublikowana nie trafia do
 * indeksu wyszukiwarek, nawet gdyby ktoś zobaczył jej adres.
 */
export function legalPageMetadata(key: LegalDocumentKey): Metadata {
  const published = isLegalPagePublished(key);
  return {
    title: LEGAL_DOCUMENTS[key].title,
    robots: { index: published, follow: published },
  };
}

/**
 * Treść strony dokumentu prawnego. Zwykła funkcja, nie komponent: strona
 * woła ją bezpośrednio, więc `notFound()` rzuca już w samej stronie, zanim
 * powstanie jakikolwiek element (i test może to sprawdzić wywołaniem strony).
 */
export function renderLegalPage(key: LegalDocumentKey) {
  if (!isLegalPagePublished(key)) notFound();

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 md:py-16">
      <h1 className="font-[family-name:var(--font-playfair)] text-3xl font-bold tracking-tight md:text-4xl">
        {LEGAL_DOCUMENTS[key].title}
      </h1>
      <LegalContent blocks={parseLegalMarkdown(LEGAL_CONTENT[key])} />
    </div>
  );
}

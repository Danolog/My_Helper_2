/**
 * Treść dokumentów prawnych, po jednym module na dokument.
 *
 * Treść to prosty markdown (nagłówki, akapity, listy, tabele), który
 * `parseLegalMarkdown` zamienia na strukturę danych. Strona dokumentu renderuje
 * ją bez surowego HTML. Opublikowanie strony nadal zależy wyłącznie od flagi
 * i rejestru w `@/lib/legal/documents`.
 */
import type { LegalDocumentKey } from "@/lib/legal/documents";
import { CONTACT_CONTENT } from "./contact";
import { DPA_CONTENT } from "./dpa";
import { PRIVACY_CONTENT } from "./privacy";
import { SUBPROCESSORS_CONTENT } from "./subprocessors";
import { TERMS_CONTENT } from "./terms";

export type LegalContent = Readonly<Record<LegalDocumentKey, string>>;

export const LEGAL_CONTENT: LegalContent = {
  privacy: PRIVACY_CONTENT,
  terms: TERMS_CONTENT,
  dpa: DPA_CONTENT,
  subprocessors: SUBPROCESSORS_CONTENT,
  contact: CONTACT_CONTENT,
};

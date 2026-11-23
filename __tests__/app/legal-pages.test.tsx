/**
 * Strony dokumentów prawnych przy wyłączonej fladze publikacji.
 *
 * Każda z pięciu stron rzuca `notFound()` już przy wywołaniu (bez względu
 * na sesję i rolę — strona nie czyta sesji), a jej metadane wyłączają
 * indeksowanie.
 */
import { describe, it, expect, vi } from "vitest";
import ContactPage, { metadata as contactMetadata } from "@/app/(site)/contact/page";
import DpaPage, { metadata as dpaMetadata } from "@/app/(site)/dpa/page";
import SubprocessorsPage, {
  metadata as subprocessorsMetadata,
} from "@/app/(site)/podprocesorzy/page";
import PrivacyPage, { metadata as privacyMetadata } from "@/app/(site)/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/(site)/terms/page";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";

const NOT_FOUND = "NEXT_NOT_FOUND";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const PAGES = [
  { key: "privacy", Page: PrivacyPage, metadata: privacyMetadata },
  { key: "terms", Page: TermsPage, metadata: termsMetadata },
  { key: "dpa", Page: DpaPage, metadata: dpaMetadata },
  { key: "subprocessors", Page: SubprocessorsPage, metadata: subprocessorsMetadata },
  { key: "contact", Page: ContactPage, metadata: contactMetadata },
] as const;

describe.each(PAGES)("strona $key przy wyłączonej fladze", ({ key, Page, metadata }) => {
  it("wywołanie strony rzuca notFound", () => {
    expect(() => Page()).toThrow(NOT_FOUND);
  });

  it("metadane: tytuł dokumentu, bez indeksowania", () => {
    expect(metadata.title).toBe(LEGAL_DOCUMENTS[key].title);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

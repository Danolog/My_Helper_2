/**
 * Strony dokumentów prawnych a flaga publikacji.
 *
 * Stan publikacji ustawia test (atrapa `isLegalPagePublished` przekazuje jawną
 * flagę do prawdziwej funkcji), więc wynik nie zależy od wartości flagi
 * w module. Przy wyłączonej fladze każda z pięciu stron rzuca `notFound()` już
 * przy wywołaniu (bez względu na sesję i rolę — strona nie czyta sesji), a jej
 * metadane wyłączają indeksowanie. Metadane liczą się przy imporcie strony,
 * czyli przy fladze wyłączonej.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import ContactPage, { metadata as contactMetadata } from "@/app/(site)/contact/page";
import DpaPage, { metadata as dpaMetadata } from "@/app/(site)/dpa/page";
import SubprocessorsPage, {
  metadata as subprocessorsMetadata,
} from "@/app/(site)/podprocesorzy/page";
import PrivacyPage, { metadata as privacyMetadata } from "@/app/(site)/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/(site)/terms/page";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";

const NOT_FOUND = "NEXT_NOT_FOUND";

const legal = vi.hoisted(() => ({ published: false }));

vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/documents")>();
  const versioned: import("@/lib/legal/documents").LegalDocuments = {
    ...actual.LEGAL_DOCUMENTS,
    privacy: { ...actual.LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
    terms: { ...actual.LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
    dpa: { ...actual.LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
  };
  return {
    ...actual,
    isLegalPagePublished: (
      key: import("@/lib/legal/documents").LegalDocumentKey,
      published: boolean = legal.published,
      documents: import("@/lib/legal/documents").LegalDocuments = versioned,
    ) => actual.isLegalPagePublished(key, published, documents),
  };
});

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

afterEach(cleanup);

describe.each(PAGES)("strona $key przy wyłączonej fladze", ({ key, Page, metadata }) => {
  beforeEach(() => {
    legal.published = false;
  });

  it("wywołanie strony rzuca notFound", () => {
    expect(() => Page()).toThrow(NOT_FOUND);
  });

  it("metadane: tytuł dokumentu, bez indeksowania", () => {
    expect(metadata.title).toBe(LEGAL_DOCUMENTS[key].title);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe.each(PAGES)("strona $key przy włączonej fladze", ({ key, Page }) => {
  beforeEach(() => {
    legal.published = true;
  });

  it("strona renderuje się z tytułem dokumentu, bez notFound", () => {
    render(Page());
    expect(screen.getAllByRole("heading", { level: 1 })[0]).toHaveTextContent(
      LEGAL_DOCUMENTS[key].title,
    );
  });
});

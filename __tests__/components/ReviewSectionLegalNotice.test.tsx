/**
 * ReviewSection — informacja o publiczności opinii przy formularzu opinii klienta.
 *
 * Regulamin (pkt 8.3) zapowiada, że klient zobaczy tę informację przy formularzu.
 * Stan publikacji przychodzi do prawdziwej funkcji `reviewLegalNotice` jako parametr.
 * Wartość domyślną komponentu ustawia test (atrapa `reviewLegalNotice` przekazuje
 * jawną flagę do prawdziwej funkcji), więc wynik nie zależy od wartości flagi
 * w module. Przy wyłączonej fladze nie ma zdania ani odnośnika do strony, która
 * odpowiada 404.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSection } from "@/app/(client)/appointments/[id]/_components/review-section";
import { TERMS_CONTENT } from "@/lib/legal/content/terms";
import {
  LEGAL_DOCUMENTS,
  REVIEW_PUBLICITY_SENTENCE,
  reviewLegalNotice,
  type LegalDocuments,
} from "@/lib/legal/documents";

const legal = vi.hoisted(() => ({ published: false }));

vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/documents")>();
  const versioned: LegalDocuments = {
    ...actual.LEGAL_DOCUMENTS,
    privacy: { ...actual.LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
    terms: { ...actual.LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
    dpa: { ...actual.LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
  };
  return {
    ...actual,
    reviewLegalNotice: (
      published: boolean = legal.published,
      documents: LegalDocuments = versioned,
    ) => actual.reviewLegalNotice(published, documents),
  };
});

beforeEach(() => {
  legal.published = false;
});

afterEach(cleanup);

const PUBLISHED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
};

type Props = Parameters<typeof ReviewSection>[0];

function props(showReviewForm: boolean, legalNotice?: Props["legalNotice"]): Props {
  const base: Props = {
    existingReview: null,
    reviewLoading: false,
    showReviewForm,
    reviewRating: 0,
    reviewHoverRating: 0,
    reviewComment: "",
    submittingReview: false,
    onShowReviewForm: () => {},
    onResetReviewForm: () => {},
    onSetRating: () => {},
    onSetHoverRating: () => {},
    onSetComment: () => {},
    onSubmitReview: () => {},
  };
  // Brak klucza = wartość domyślna komponentu (stan ustawiony w teście).
  return legalNotice === undefined ? base : { ...base, legalNotice };
}

describe("treść zdania", () => {
  it("zdanie przy formularzu jest dosłownie w regulaminie", () => {
    expect(TERMS_CONTENT).toContain(REVIEW_PUBLICITY_SENTENCE);
  });
});

describe("flaga wyłączona", () => {
  it("wartość domyślna komponentu: formularz bez zdania i bez odnośnika do /terms", () => {
    const { container } = render(<ReviewSection {...props(true)} />);

    expect(screen.getByTestId("review-form")).toBeInTheDocument();
    expect(screen.queryByTestId("review-legal-notice")).toBeNull();
    expect(container.textContent).not.toContain(REVIEW_PUBLICITY_SENTENCE);
    expect(container.querySelector('a[href="/terms"]')).toBeNull();
  });

  it("stan przekazany wprost (flaga false) daje to samo", () => {
    expect(reviewLegalNotice(false, PUBLISHED)).toBeNull();
    render(<ReviewSection {...props(true, reviewLegalNotice(false, PUBLISHED))} />);
    expect(screen.queryByTestId("review-legal-notice")).toBeNull();
  });
});

describe("flaga włączona", () => {
  it("formularz: zdanie z regulaminu i odnośnik do /terms w nowej karcie", () => {
    render(<ReviewSection {...props(true, reviewLegalNotice(true, PUBLISHED))} />);

    const notice = screen.getByTestId("review-legal-notice");
    expect(notice.textContent).toContain(REVIEW_PUBLICITY_SENTENCE);
    const link = screen.getByRole("link", { name: "regulamin" });
    expect(link).toHaveAttribute("href", "/terms");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("wartość domyślna komponentu: formularz ze zdaniem i odnośnikiem do /terms", () => {
    legal.published = true;
    render(<ReviewSection {...props(true)} />);

    expect(screen.getByTestId("review-legal-notice").textContent).toContain(REVIEW_PUBLICITY_SENTENCE);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
  });

  it("zdanie tylko przy otwartym formularzu, nie przy samym przycisku", () => {
    render(<ReviewSection {...props(false, reviewLegalNotice(true, PUBLISHED))} />);
    expect(screen.getByTestId("leave-review-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("review-legal-notice")).toBeNull();
  });

  it("regulamin bez wersji: strona nieopublikowana, więc bez zdania", () => {
    const documents: LegalDocuments = {
      ...PUBLISHED,
      terms: { ...PUBLISHED.terms, version: null },
    };
    expect(reviewLegalNotice(true, documents)).toBeNull();
  });
});

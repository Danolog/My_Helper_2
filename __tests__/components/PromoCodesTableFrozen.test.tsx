/**
 * Kod rabatowy powiązany z promocją zamrożonego typu (B2.1, wiersz 16,
 * recenzja N2): karta kodu nie może udawać działającego rabatu. Zamiast typu
 * i wartości — „Promocja niedostępna” i podpowiedź, co zrobić; bez „Aktywny”.
 * Kontrola: kod z rabatem procentowym pokazuje typ i wartość jak dotąd.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PromoCodesTable } from "@/app/dashboard/promo-codes/_components/PromoCodesTable";
import type { PromoCode } from "@/app/dashboard/promo-codes/_types";
import { FROZEN_PROMOTION_TYPES } from "@/lib/features";

const CAPTION = "Ten kod nie daje rabatu. Powiąż go z rabatem procentowym lub kwotowym.";

function code(type: string | null): PromoCode {
  return {
    id: `code-${type ?? "none"}`,
    salonId: "salon-1",
    code: "LATO2026",
    promotionId: type ? "promo-1" : null,
    usageLimit: null,
    usedCount: 0,
    expiresAt: null,
    createdAt: "2026-06-01T10:00:00Z",
    promotion: type
      ? { id: "promo-1", salonId: "salon-1", name: "Wakacje", type, value: "20", isActive: true }
      : null,
  };
}

function renderTable(codes: PromoCode[]) {
  return render(
    <PromoCodesTable
      codesList={codes}
      loading={false}
      onCreateClick={vi.fn()}
      onEditClick={vi.fn()}
      onDeleteClick={vi.fn()}
      onCopyClick={vi.fn()}
    />
  );
}

describe("PromoCodesTable — promocja zamrożonego typu", () => {
  it.each(FROZEN_PROMOTION_TYPES)("%s: badge „Promocja niedostępna” i podpis, bez „Aktywny”", (type) => {
    renderTable([code(type)]);
    expect(screen.getByText("Promocja niedostępna")).toBeInTheDocument();
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    expect(screen.getByText("Wakacje")).toBeInTheDocument();
    expect(screen.queryByText("Aktywny")).not.toBeInTheDocument();
    expect(screen.queryByText(/20%/)).not.toBeInTheDocument();
  });

  it("kontrola: rabat procentowy pokazuje typ i wartość, bez ostrzeżenia", () => {
    renderTable([code("percentage")]);
    expect(screen.getByText(/Procentowa/)).toHaveTextContent("Procentowa 20%");
    expect(screen.getByText("Aktywny")).toBeInTheDocument();
    expect(screen.queryByText("Promocja niedostępna")).not.toBeInTheDocument();
    expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();
  });

  it("kontrola: kod bez promocji — bez ostrzeżenia", () => {
    renderTable([code(null)]);
    expect(screen.getByText("Brak powiazanej promocji")).toBeInTheDocument();
    expect(screen.queryByText("Promocja niedostępna")).not.toBeInTheDocument();
  });
});

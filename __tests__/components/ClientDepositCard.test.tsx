import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ClientDepositCard, CLIENT_DEPOSIT_SCOPE_NOTE } from "@/components/clients/client-deposit-card";

// #66 (decyzja Sophii, komentarz 6893390621): flaga klienta „Wymagaj zadatku”
// zostaje widoczna, z jawnym zakresem — działa tylko dla zalogowanych klientów
// portalu, rezerwacji jako gość nie obejmuje.

const SOPHIA_TEXT =
  "Działa tylko wtedy, gdy klient rezerwuje online zalogowany na konto z potwierdzonym e-mailem, a w tej kartotece jest wpisany dokładnie ten sam e-mail. Nie działa przy rezerwacji bez logowania (jako gość) ani gdy kartoteka nie ma e-maila.";

function renderCard(formRequireDeposit: boolean) {
  return render(
    <ClientDepositCard
      formRequireDeposit={formRequireDeposit}
      formDepositType="percentage"
      formDepositValue="30"
      onRequireDepositChange={vi.fn()}
      onDepositTypeChange={vi.fn()}
      onDepositValueChange={vi.fn()}
    />
  );
}

describe("ClientDepositCard — zakres flagi klienta (#66)", () => {
  it("tekst Sophii jest dosłownie tym z decyzji", () => {
    expect(CLIENT_DEPOSIT_SCOPE_NOTE).toBe(SOPHIA_TEXT);
  });

  it.each([false, true])("flaga %s: przełącznik widoczny i tekst o zakresie wyświetlony obok", (on) => {
    renderCard(on);
    expect(screen.getByTestId("require-deposit-select")).toBeInTheDocument();
    expect(screen.getByText("Wymagaj zadatku")).toBeInTheDocument();
    expect(screen.getByTestId("require-deposit-scope-note")).toHaveTextContent(SOPHIA_TEXT);
  });
});

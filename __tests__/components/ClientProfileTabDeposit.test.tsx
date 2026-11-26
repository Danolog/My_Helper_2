import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientProfileTab } from "@/components/clients/client-profile-tab";
import type { ClientData } from "@/components/clients/types";

// Karta „Ustawienia zadatku” w profilu klienta: przy wyłączonym zadatku
// (isDepositEnabled) się nie renderuje, po włączeniu wraca.

const flags = vi.hoisted(() => ({ deposit: false }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isDepositEnabled: () => flags.deposit,
}));

// Pozostałe karty profilu mają własne pobieranie i stan — tu bez znaczenia.
vi.mock("@/components/clients/client-contact-card", () => ({
  ClientContactCard: () => <div data-testid="stub-contact" />,
}));
vi.mock("@/components/clients/client-favorite-employee-card", () => ({
  ClientFavoriteEmployeeCard: () => <div data-testid="stub-favorite" />,
}));
vi.mock("@/components/clients/client-health-preferences-card", () => ({
  ClientHealthPreferencesCard: () => <div data-testid="stub-health" />,
}));
vi.mock("@/components/clients/client-consents-card", () => ({
  ClientConsentsCard: () => <div data-testid="stub-consents" />,
}));

const CLIENT = {
  id: "client-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as ClientData;

function renderTab() {
  return render(
    <ClientProfileTab
      client={CLIENT}
      clientId="client-1"
      formFirstName="Anna"
      formLastName="Nowak"
      formPhone=""
      formEmail=""
      formBirthday=""
      formErrors={{}}
      formNotes=""
      allergiesList={[]}
      preferencesList={[]}
      healthConsentChecked={false}
      savedHealthConsent={null}
      healthConsentError={null}
      employees={[]}
      selectedFavoriteEmployeeId=""
      formRequireDeposit={true}
      formDepositType="percentage"
      formDepositValue="30"
      onFirstNameChange={vi.fn()}
      onLastNameChange={vi.fn()}
      onPhoneChange={vi.fn()}
      onEmailChange={vi.fn()}
      onBirthdayChange={vi.fn()}
      onClearFieldError={vi.fn()}
      onNotesChange={vi.fn()}
      onHealthConsentChange={vi.fn()}
      onAllergiesChange={vi.fn()}
      onPreferencesChange={vi.fn()}
      onFavoriteEmployeeChange={vi.fn()}
      onRequireDepositChange={vi.fn()}
      onDepositTypeChange={vi.fn()}
      onDepositValueChange={vi.fn()}
    />
  );
}

describe("ClientProfileTab — karta ustawień zadatku", () => {
  beforeEach(() => {
    flags.deposit = false;
  });

  it("zadatek wyłączony: karty nie ma, także dla klienta z zapisaną flagą", () => {
    renderTab();

    expect(screen.queryByTestId("deposit-settings-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("require-deposit-select")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/zadat/i);
    // Reszta profilu zostaje.
    expect(screen.getByTestId("stub-contact")).toBeInTheDocument();
    expect(screen.getByTestId("client-meta-card")).toBeInTheDocument();
  });

  it("zadatek włączony: karta wraca", () => {
    flags.deposit = true;
    renderTab();

    expect(screen.getByTestId("deposit-settings-card")).toBeInTheDocument();
    expect(screen.getByTestId("require-deposit-select")).toBeInTheDocument();
  });
});

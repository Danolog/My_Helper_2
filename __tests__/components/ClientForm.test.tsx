import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientForm } from "@/app/dashboard/clients/_components/ClientForm";

/**
 * Notatka nie trafia do szkicu formularza, wiec uzytkownik musi o tym
 * wiedziec, zanim odswiezy strone z wpisana notatka.
 */

function renderClientForm() {
  return render(
    <ClientForm
      dialogOpen
      onOpenChange={vi.fn()}
      saving={false}
      formFirstName=""
      onFirstNameChange={vi.fn()}
      formLastName=""
      onLastNameChange={vi.fn()}
      formPhone=""
      onPhoneChange={vi.fn()}
      formEmail=""
      onEmailChange={vi.fn()}
      formNotes=""
      onNotesChange={vi.fn()}
      formErrors={{}}
      clearFieldError={vi.fn()}
      clientWasRecovered={false}
      onRestore={vi.fn()}
      onDismissRecovery={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("ClientForm — notes draft hint", () => {
  it("tells the user that notes are not kept in the form draft", () => {
    renderClientForm();

    expect(
      screen.getByText("Notatki nie sa zapisywane w szkicu formularza."),
    ).toBeInTheDocument();
  });

  it("links the hint to the notes field for screen readers", () => {
    renderClientForm();

    expect(screen.getByTestId("client-notes-input")).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("client-notes-draft-hint").id,
    );
  });
});

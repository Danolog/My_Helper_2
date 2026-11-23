/**
 * Konto klienta a akceptacja regulaminu i polityki prywatności (bez zapisu w bazie):
 * pole wyboru w formularzu e-mailowym (SignUpForm) i zdanie przy przycisku Google
 * (SignInButton na logowaniu klienta).
 *
 * Stan publikacji trafia do prawdziwej funkcji `clientAccountLegalNotice` jako
 * parametr (bez atrapy modułu dokumentów). Atrapy: router i klient logowania.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInButton } from "@/components/auth/sign-in-button";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { signUp } from "@/lib/auth-client";
import {
  LEGAL_DOCUMENTS,
  clientAccountLegalNotice,
  isClientAccountAcceptanceComplete,
  type LegalDocuments,
} from "@/lib/legal/documents";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  signUp: { email: vi.fn(async () => ({ data: {}, error: null })) },
  signIn: { email: vi.fn(), social: vi.fn() },
  useSession: () => ({ data: null, isPending: false }),
  sendVerificationEmail: vi.fn(),
}));

const PUBLISHED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-01" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-01" },
};

const GOOGLE_SENTENCE = "Kontynuując, akceptujesz regulamin i politykę prywatności";
const SUBMIT = "Utworz konto";
const CHECKBOX = /Akceptuję regulamin i politykę prywatności/;

beforeEach(() => {
  vi.mocked(signUp.email).mockClear();
});

afterEach(cleanup);

async function fillSignUp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
  await user.type(screen.getByLabelText("Email"), "jan@example.com");
  await user.type(screen.getByLabelText("Haslo"), "haslo1234");
  await user.type(screen.getByLabelText("Potwierdz haslo"), "haslo1234");
}

describe("pomocniki", () => {
  it("flaga wyłączona: brak akceptacji, rejestracja niezablokowana", () => {
    expect(clientAccountLegalNotice()).toBeNull();
    expect(clientAccountLegalNotice(false, PUBLISHED)).toBeNull();
    expect(isClientAccountAcceptanceComplete(null, false)).toBe(true);
  });

  it("flaga włączona: odnośniki do /terms i /privacy, wymagane zaznaczenie", () => {
    const notice = clientAccountLegalNotice(true, PUBLISHED);
    expect(notice?.terms.href).toBe("/terms");
    expect(notice?.privacy.href).toBe("/privacy");
    expect(isClientAccountAcceptanceComplete(notice, false)).toBe(false);
    expect(isClientAccountAcceptanceComplete(notice, true)).toBe(true);
  });

  it("flaga włączona, regulamin bez wersji: brak akceptacji (strona nie jest opublikowana)", () => {
    const noTermsVersion: LegalDocuments = {
      ...PUBLISHED,
      terms: { ...PUBLISHED.terms, version: null },
    };
    expect(clientAccountLegalNotice(true, noTermsVersion)).toBeNull();
  });
});

describe("formularz e-mailowy konta klienta: flaga wyłączona", () => {
  it("wartość z modułu: bez pola wyboru i odnośników, rejestracja działa", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignUpForm showPhone redirectTo="/salons" />);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(container.querySelector('a[href="/terms"]')).toBeNull();
    expect(container.querySelector('a[href="/privacy"]')).toBeNull();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeEnabled();

    await fillSignUp(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    await waitFor(() => expect(signUp.email).toHaveBeenCalledTimes(1));
  });

  it("stan przekazany wprost (flaga false) daje to samo", () => {
    render(<SignUpForm legalNotice={clientAccountLegalNotice(false, PUBLISHED)} />);
    expect(screen.queryByTestId("client-account-legal-acceptance")).toBeNull();
  });
});

describe("formularz e-mailowy konta klienta: flaga włączona", () => {
  const notice = () => clientAccountLegalNotice(true, PUBLISHED);

  it("pole wyboru z odnośnikami do /terms i /privacy w nowej karcie", () => {
    render(<SignUpForm legalNotice={notice()} />);

    expect(screen.getByRole("checkbox", { name: CHECKBOX })).not.toBeChecked();
    for (const [name, href] of [
      ["regulamin", "/terms"],
      ["politykę prywatności", "/privacy"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("przycisk zablokowany do zaznaczenia; Enter nie wysyła formularza", async () => {
    const user = userEvent.setup();
    render(<SignUpForm legalNotice={notice()} />);

    await fillSignUp(user);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();

    await user.type(screen.getByLabelText("Potwierdz haslo"), "{enter}");
    expect(signUp.email).not.toHaveBeenCalled();
  });

  it("po zaznaczeniu rejestracja wysyła żądanie bez pól akceptacji (nic nie trafia do bazy)", async () => {
    const user = userEvent.setup();
    render(<SignUpForm legalNotice={notice()} redirectTo="/salons" />);

    await fillSignUp(user);
    await user.click(screen.getByRole("checkbox", { name: CHECKBOX }));
    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(signUp.email).toHaveBeenCalledTimes(1));
    expect(vi.mocked(signUp.email).mock.calls[0]?.[0]).toEqual({
      name: "Jan Kowalski",
      email: "jan@example.com",
      password: "haslo1234",
      callbackURL: "/salons",
    });
  });

  it("odznaczenie znowu blokuje przycisk", async () => {
    const user = userEvent.setup();
    render(<SignUpForm legalNotice={notice()} />);

    const checkbox = screen.getByRole("checkbox", { name: CHECKBOX });
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeEnabled();
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
  });
});

describe("przycisk Google na logowaniu klienta", () => {
  it("flaga wyłączona (wartość z modułu): bez zdania i odnośników", () => {
    const { container } = render(
      <SignInButton googleEnabled googleLegalNotice={clientAccountLegalNotice()} />,
    );

    expect(screen.getByRole("button", { name: /Zaloguj sie przez Google/ })).toBeEnabled();
    expect(screen.queryByTestId("google-legal-notice")).toBeNull();
    expect(container.textContent).not.toContain(GOOGLE_SENTENCE);
    expect(container.querySelector('a[href="/terms"]')).toBeNull();
  });

  it("flaga włączona: zdanie z odnośnikami, przycisk Google bez blokady", () => {
    render(
      <SignInButton googleEnabled googleLegalNotice={clientAccountLegalNotice(true, PUBLISHED)} />,
    );

    expect(screen.getByTestId("google-legal-notice").textContent).toContain(GOOGLE_SENTENCE);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "politykę prywatności" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("button", { name: /Zaloguj sie przez Google/ })).toBeEnabled();
  });

  it("bez przycisku Google nie ma też zdania", () => {
    render(<SignInButton googleLegalNotice={clientAccountLegalNotice(true, PUBLISHED)} />);
    expect(screen.queryByTestId("google-legal-notice")).toBeNull();
  });

  it("logowanie salonu (bez propsa): domyślnie bez zdania niezależnie od flagi", () => {
    render(<SignInButton googleEnabled />);
    expect(screen.queryByTestId("google-legal-notice")).toBeNull();
  });
});

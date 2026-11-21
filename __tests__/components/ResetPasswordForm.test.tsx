import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// Mock Next.js navigation. useSearchParams czyta BIEŻĄCY adres przy każdym
// renderze — tak jak w Next 16, gdzie history.replaceState aktualizuje
// useSearchParams. Formularz, który czytałby token z searchParams, po usunięciu
// tokenu z adresu pokazałby „Brak tokenu”.
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Mock Next.js Link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock auth client
const mockResetPassword = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  resetPassword: (...args: unknown[]) => mockResetPassword(...args),
}));

// Mock error messages
vi.mock("@/lib/error-messages", () => ({
  sanitizeAuthError: (message: string | undefined, fallback: string) =>
    message || fallback,
}));

/** Adres strony resetu w oknie testu (ścieżka + zapytanie). */
function openAt(search: string) {
  window.history.replaceState(null, "", `/reset-password${search}`);
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nowe haslo"), "newpassword123");
  await user.type(screen.getByLabelText("Potwierdz nowe haslo"), "newpassword123");
  await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));
}

describe("ResetPasswordForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    openAt("?token=valid-token-123");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("renders the form with password fields when token is present", () => {
    render(<ResetPasswordForm />);

    expect(screen.getByLabelText("Nowe haslo")).toBeInTheDocument();
    expect(screen.getByLabelText("Potwierdz nowe haslo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zresetuj haslo" })
    ).toBeInTheDocument();
  });

  it("shows missing token message when no token in URL", () => {
    openAt("");
    const spy = vi.spyOn(window.history, "replaceState");
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        "Brak tokenu resetowania. Uzyj linku z wiadomosci email."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Wyslij nowy link")).toBeInTheDocument();
    // Bez tokenu w adresie nie ma czego usuwać.
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows missing token message when token param is empty", () => {
    openAt("?token=");
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        "Brak tokenu resetowania. Uzyj linku z wiadomosci email."
      )
    ).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("shows invalid token message when error param is invalid_token", () => {
    openAt("?token=expired&error=invalid_token");
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        "Ten link do resetowania hasla jest nieprawidlowy lub wygasl."
      )
    ).toBeInTheDocument();
  });

  // --- token poza adresem (Referer, historia przeglądarki) -------------------

  it("removes the token from the address bar after the first render", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(window.location.pathname).toBe("/reset-password");
    expect(window.location.href).not.toContain("valid-token-123");
    // Wywołanie z formularza: adres bez tokenu, stan historii routera bez zmian.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[2]).toBe("/reset-password");
  });

  // Stan null = wywołanie przejmuje Next.js (zachowuje swój stan historii
  // i synchronizuje adres routera). Przekazanie stanu routera (__NA) ominęłoby
  // synchronizację i router mógłby przywrócić adres z tokenem.
  it("calls history.replaceState with null state, even when the router state is present", async () => {
    window.history.replaceState({ __NA: true, tree: "router-tree" }, "", "/reset-password?token=valid-token-123");
    const spy = vi.spyOn(window.history, "replaceState");
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBeNull();
  });

  it("removes only the token: other params and the fragment stay", async () => {
    openAt("?token=valid-token-123&error=invalid_token#x");
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(window.location.search).toBe("?error=invalid_token");
    });
    expect(window.location.hash).toBe("#x");
    expect(window.location.href).not.toContain("valid-token-123");
    expect(
      screen.getByText(
        "Ten link do resetowania hasla jest nieprawidlowy lub wygasl."
      )
    ).toBeInTheDocument();
  });

  it("after the token is removed from the address the form still shows and sends the token", async () => {
    mockResetPassword.mockResolvedValue({ data: {} });
    const { rerender } = render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    // Next 16: zmiana adresu odświeża useSearchParams i komponent renderuje się ponownie.
    window.history.replaceState(window.history.state, "", "/reset-password");
    rerender(<ResetPasswordForm />);

    expect(
      screen.queryByText("Brak tokenu resetowania. Uzyj linku z wiadomosci email.")
    ).not.toBeInTheDocument();
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: "newpassword123",
        token: "valid-token-123",
      });
    });
    expect(mockReplace).toHaveBeenCalledWith("/login?reset=success");
  });

  it("shows error and keeps the form usable when reset fails after the token was removed", async () => {
    mockResetPassword
      .mockResolvedValueOnce({ error: { message: "Token expired" } })
      .mockResolvedValueOnce({ data: {} });
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Token expired")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Brak tokenu resetowania. Uzyj linku z wiadomosci email.")
    ).not.toBeInTheDocument();

    // Ponowna próba nadal wysyła ten sam token.
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));
    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledTimes(2);
    });
    expect(mockResetPassword).toHaveBeenLastCalledWith({
      newPassword: "newpassword123",
      token: "valid-token-123",
    });
  });

  it("shows generic error when resetPassword throws", async () => {
    mockResetPassword.mockRejectedValue(new Error("network down"));
    render(<ResetPasswordForm />);

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(
        screen.getByText("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  // --- walidacja i wysyłka (bez zmian) ---------------------------------------

  it("shows validation errors for empty password fields", async () => {
    render(<ResetPasswordForm />);

    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

    expect(
      screen.getByText("Podaj nowe haslo (minimum 8 znakow)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wpisz haslo ponownie w celu potwierdzenia")
    ).toBeInTheDocument();
  });

  it("validates minimum password length", async () => {
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("Nowe haslo"), "short");
    await user.type(screen.getByLabelText("Potwierdz nowe haslo"), "short");
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

    expect(
      screen.getByText("Haslo jest za krotkie. Wpisz co najmniej 8 znakow")
    ).toBeInTheDocument();
  });

  it("validates password confirmation match", async () => {
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("Nowe haslo"), "password123");
    await user.type(
      screen.getByLabelText("Potwierdz nowe haslo"),
      "different123"
    );
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

    expect(
      screen.getByText(
        "Hasla nie sa identyczne. Upewnij sie, ze oba pola zawieraja to samo haslo"
      )
    ).toBeInTheDocument();
  });

  it("calls resetPassword with token and new password", async () => {
    mockResetPassword.mockResolvedValue({ data: {} });

    render(<ResetPasswordForm />);

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: "newpassword123",
        token: "valid-token-123",
      });
    });
  });

  it("redirects to login on success", async () => {
    mockResetPassword.mockResolvedValue({ data: {} });

    render(<ResetPasswordForm />);

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login?reset=success");
    });
  });

  it("shows error message on failed reset", async () => {
    mockResetPassword.mockResolvedValue({
      error: { message: "Token expired" },
    });

    render(<ResetPasswordForm />);

    await fillAndSubmit(user);

    await waitFor(() => {
      expect(screen.getByText("Token expired")).toBeInTheDocument();
    });
  });

  it("shows loading state during submission", async () => {
    mockResetPassword.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    render(<ResetPasswordForm />);

    await fillAndSubmit(user);

    expect(
      screen.getByRole("button", { name: "Resetowanie..." })
    ).toBeDisabled();
  });

  it("clears field errors when user types", async () => {
    render(<ResetPasswordForm />);

    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));
    expect(
      screen.getByText("Podaj nowe haslo (minimum 8 znakow)")
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nowe haslo"), "a");

    expect(
      screen.queryByText("Podaj nowe haslo (minimum 8 znakow)")
    ).not.toBeInTheDocument();
  });
});

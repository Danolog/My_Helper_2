import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

// Mock Next.js navigation
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams("token=valid-token-123");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => mockSearchParams,
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

describe("ResetPasswordForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams("token=valid-token-123");
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
    mockSearchParams = new URLSearchParams("");
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        "Brak tokenu resetowania. Uzyj linku z wiadomosci email."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Wyslij nowy link")).toBeInTheDocument();
  });

  it("shows invalid token message when error param is invalid_token", () => {
    mockSearchParams = new URLSearchParams(
      "token=expired&error=invalid_token"
    );
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        "Ten link do resetowania hasla jest nieprawidlowy lub wygasl."
      )
    ).toBeInTheDocument();
  });

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

    await user.type(screen.getByLabelText("Nowe haslo"), "newpassword123");
    await user.type(
      screen.getByLabelText("Potwierdz nowe haslo"),
      "newpassword123"
    );
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

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

    await user.type(screen.getByLabelText("Nowe haslo"), "newpassword123");
    await user.type(
      screen.getByLabelText("Potwierdz nowe haslo"),
      "newpassword123"
    );
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login?reset=success");
    });
  });

  it("shows error message on failed reset", async () => {
    mockResetPassword.mockResolvedValue({
      error: { message: "Token expired" },
    });

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("Nowe haslo"), "newpassword123");
    await user.type(
      screen.getByLabelText("Potwierdz nowe haslo"),
      "newpassword123"
    );
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

    await waitFor(() => {
      expect(screen.getByText("Token expired")).toBeInTheDocument();
    });
  });

  it("shows loading state during submission", async () => {
    mockResetPassword.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText("Nowe haslo"), "newpassword123");
    await user.type(
      screen.getByLabelText("Potwierdz nowe haslo"),
      "newpassword123"
    );
    await user.click(screen.getByRole("button", { name: "Zresetuj haslo" }));

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

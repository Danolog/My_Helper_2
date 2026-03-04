import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

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
const mockRequestPasswordReset = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  requestPasswordReset: (...args: unknown[]) =>
    mockRequestPasswordReset(...args),
}));

// Mock error messages
vi.mock("@/lib/error-messages", () => ({
  sanitizeAuthError: (message: string | undefined, fallback: string) =>
    message || fallback,
}));

describe("ForgotPasswordForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the form with email field and submit button", () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    ).toBeInTheDocument();
  });

  it("renders link back to login", () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByText("Zaloguj sie")).toHaveAttribute("href", "/login");
  });

  it("shows validation error for empty email", async () => {
    render(<ForgotPasswordForm />);

    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    expect(
      screen.getByText("Podaj adres email przypisany do konta")
    ).toBeInTheDocument();
  });

  it("shows validation error for invalid email format", async () => {
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    expect(
      screen.getByText(
        "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
      )
    ).toBeInTheDocument();
  });

  it("calls requestPasswordReset on valid submission", async () => {
    mockRequestPasswordReset.mockResolvedValue({ data: {} });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: "jan@example.com",
        redirectTo: "/reset-password",
      });
    });
  });

  it("shows success message after successful submission", async () => {
    mockRequestPasswordReset.mockResolvedValue({ data: {} });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/link do resetowania hasla zostal wyslany/)
      ).toBeInTheDocument();
    });

    // Should show button to go back to login
    expect(screen.getByText("Powrot do logowania")).toBeInTheDocument();
  });

  it("shows error message when API returns error", async () => {
    mockRequestPasswordReset.mockResolvedValue({
      error: { message: "Server error" },
    });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("shows generic error on exception", async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error("Network fail"));

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
        )
      ).toBeInTheDocument();
    });
  });

  it("shows loading state during submission", async () => {
    mockRequestPasswordReset.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );

    expect(
      screen.getByRole("button", { name: "Wysylanie..." })
    ).toBeDisabled();
  });

  it("clears field errors when user types", async () => {
    render(<ForgotPasswordForm />);

    await user.click(
      screen.getByRole("button", { name: "Wyslij link resetowania" })
    );
    expect(
      screen.getByText("Podaj adres email przypisany do konta")
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "a");

    expect(
      screen.queryByText("Podaj adres email przypisany do konta")
    ).not.toBeInTheDocument();
  });
});

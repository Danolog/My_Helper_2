import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignUpForm } from "@/components/auth/sign-up-form";

// Mock Next.js navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
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
const mockSignUpEmail = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  signUp: {
    email: (...args: unknown[]) => mockSignUpEmail(...args),
  },
  sendVerificationEmail: vi.fn(),
}));

// Mock validations
vi.mock("@/lib/validations", () => ({
  validatePhone: (phone: string) => {
    if (phone && phone.length < 7) return "Numer telefonu jest za krotki";
    return null;
  },
}));

// Mock error messages
vi.mock("@/lib/error-messages", () => ({
  sanitizeAuthError: (message: string | undefined, fallback: string) =>
    message || fallback,
}));

describe("SignUpForm", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all form fields correctly", () => {
    render(<SignUpForm />);

    expect(screen.getByLabelText("Imie i nazwisko")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Haslo")).toBeInTheDocument();
    expect(screen.getByLabelText("Potwierdz haslo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Utworz konto" })
    ).toBeInTheDocument();
  });

  it("renders login link with default href", () => {
    render(<SignUpForm />);

    const loginLink = screen.getByText("Zaloguj sie");
    expect(loginLink).toHaveAttribute("href", "/login");
  });

  it("renders login link with custom href", () => {
    render(<SignUpForm loginHref="/custom-login" />);

    const loginLink = screen.getByText("Zaloguj sie");
    expect(loginLink).toHaveAttribute("href", "/custom-login");
  });

  it("does not render phone field by default", () => {
    render(<SignUpForm />);
    expect(screen.queryByLabelText("Telefon")).not.toBeInTheDocument();
  });

  it("renders phone field when showPhone is true", () => {
    render(<SignUpForm showPhone />);
    expect(screen.getByLabelText("Telefon")).toBeInTheDocument();
  });

  it("shows validation errors when submitting empty form", async () => {
    render(<SignUpForm />);

    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    expect(
      screen.getByText("Wpisz swoje imie i nazwisko, np. Jan Kowalski")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Podaj adres email, np. jan@example.com")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Podaj haslo (minimum 8 znakow)")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wpisz haslo ponownie w celu potwierdzenia")
    ).toBeInTheDocument();
  });

  it("validates email format", async () => {
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "invalid-email");
    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    expect(
      screen.getByText(
        "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
      )
    ).toBeInTheDocument();
  });

  it("validates password length", async () => {
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "short");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "short");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    expect(
      screen.getByText("Haslo jest za krotkie. Wpisz co najmniej 8 znakow")
    ).toBeInTheDocument();
  });

  it("validates password confirmation match", async () => {
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "different123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    expect(
      screen.getByText(
        "Hasla nie sa identyczne. Upewnij sie, ze oba pola zawieraja to samo haslo"
      )
    ).toBeInTheDocument();
  });

  it("clears field errors when user types", async () => {
    render(<SignUpForm />);

    // Submit empty to trigger errors
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));
    expect(
      screen.getByText("Wpisz swoje imie i nazwisko, np. Jan Kowalski")
    ).toBeInTheDocument();

    // Start typing in name field
    await user.type(screen.getByLabelText("Imie i nazwisko"), "J");

    // The name error should be cleared
    expect(
      screen.queryByText("Wpisz swoje imie i nazwisko, np. Jan Kowalski")
    ).not.toBeInTheDocument();
  });

  it("calls signUp.email on valid submission", async () => {
    mockSignUpEmail.mockResolvedValue({ data: { user: {} } });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        name: "Jan Kowalski",
        email: "jan@example.com",
        password: "password123",
        callbackURL: "/dashboard",
      });
    });
  });

  it("shows loading state during submission", async () => {
    // Simulate slow response
    mockSignUpEmail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    expect(
      screen.getByRole("button", { name: "Tworzenie konta..." })
    ).toBeDisabled();
  });

  it("shows verification message on successful signup", async () => {
    mockSignUpEmail.mockResolvedValue({ data: { user: {} } });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    await waitFor(() => {
      expect(
        screen.getByText("Konto zostalo utworzone!")
      ).toBeInTheDocument();
    });

    // Check that the email is displayed in the message
    expect(screen.getByText("jan@example.com")).toBeInTheDocument();
  });

  it("shows error message when signup fails with API error", async () => {
    mockSignUpEmail.mockResolvedValue({
      error: { message: "User already exists" },
    });

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    await waitFor(() => {
      expect(screen.getByText("User already exists")).toBeInTheDocument();
    });
  });

  it("shows generic error when an exception is thrown", async () => {
    mockSignUpEmail.mockRejectedValue(new Error("Network error"));

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
        )
      ).toBeInTheDocument();
    });
  });

  it("uses custom redirectTo prop", async () => {
    mockSignUpEmail.mockResolvedValue({ data: { user: {} } });

    render(<SignUpForm redirectTo="/custom-redirect" />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/custom-redirect" })
      );
    });
  });

  it("disables inputs during pending state", async () => {
    mockSignUpEmail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Imie i nazwisko"), "Jan Kowalski");
    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.type(screen.getByLabelText("Potwierdz haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Utworz konto" }));

    // All inputs should be disabled while pending
    expect(screen.getByLabelText("Imie i nazwisko")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Haslo")).toBeDisabled();
    expect(screen.getByLabelText("Potwierdz haslo")).toBeDisabled();
  });
});

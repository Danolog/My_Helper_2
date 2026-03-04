import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInButton } from "@/components/auth/sign-in-button";

// Mock Next.js navigation
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
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
const mockSignInEmail = vi.fn();
const mockSignInSocial = vi.fn();
let mockSessionData: {
  data: { user: { name: string; email: string } } | null;
  isPending: boolean;
} = {
  data: null,
  isPending: false,
};

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
    social: (...args: unknown[]) => mockSignInSocial(...args),
  },
  useSession: () => mockSessionData,
}));

// Mock error messages
vi.mock("@/lib/error-messages", () => ({
  sanitizeAuthError: (message: string | undefined, fallback: string) =>
    message || fallback,
}));

describe("SignInButton", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionData = { data: null, isPending: false };
  });

  it("renders the login form when no session exists", () => {
    render(<SignInButton />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Haslo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zaloguj sie" })
    ).toBeInTheDocument();
  });

  it("shows loading button when session is pending", () => {
    mockSessionData = { data: null, isPending: true };
    render(<SignInButton />);

    expect(
      screen.getByRole("button", { name: "Ladowanie..." })
    ).toBeDisabled();
  });

  it("renders nothing when session exists", () => {
    mockSessionData = {
      data: { user: { name: "Jan", email: "jan@example.com" } },
      isPending: false,
    };
    const { container } = render(<SignInButton />);

    expect(container.innerHTML).toBe("");
  });

  it("shows validation errors when submitting empty form", async () => {
    render(<SignInButton />);

    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    expect(
      screen.getByText(
        "Wpisz adres email powiazany z kontem, np. jan@example.com"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Wpisz haslo do logowania. Jesli nie pamietasz, uzyj opcji 'Nie pamietam hasla'"
      )
    ).toBeInTheDocument();
  });

  it("validates email format", async () => {
    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "bad-email");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    expect(
      screen.getByText(
        "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
      )
    ).toBeInTheDocument();
  });

  it("calls signIn.email on valid submission", async () => {
    mockSignInEmail.mockResolvedValue({ data: { session: {} } });

    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith({
        email: "jan@example.com",
        password: "password123",
        callbackURL: "/dashboard",
      });
    });
  });

  it("redirects after successful login", async () => {
    mockSignInEmail.mockResolvedValue({ data: { session: {} } });

    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("uses returnTo for redirect when provided", async () => {
    mockSignInEmail.mockResolvedValue({ data: { session: {} } });

    render(<SignInButton returnTo="/appointments" />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/appointments" })
      );
    });
  });

  it("prevents open redirect by rejecting absolute URLs", async () => {
    mockSignInEmail.mockResolvedValue({ data: { session: {} } });

    render(<SignInButton returnTo="//evil.com" />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      // Should fall back to default redirect
      expect(mockSignInEmail).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: "/dashboard" })
      );
    });
  });

  it("shows error message on failed login", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: "Invalid credentials" },
    });

    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "wrongpassword");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });
  });

  it("shows generic error on exception", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Network error"));

    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
        )
      ).toBeInTheDocument();
    });
  });

  it("renders Google sign-in button", () => {
    render(<SignInButton />);

    expect(
      screen.getByRole("button", { name: /Zaloguj sie przez Google/ })
    ).toBeInTheDocument();
  });

  it("renders 'forgot password' and 'register' links", () => {
    render(<SignInButton />);

    expect(screen.getByText("Nie pamietam hasla")).toHaveAttribute(
      "href",
      "/forgot-password"
    );
    expect(screen.getByText("Zarejestruj sie")).toHaveAttribute(
      "href",
      "/register"
    );
  });

  it("uses custom registerHref prop", () => {
    render(<SignInButton registerHref="/custom-register" />);

    expect(screen.getByText("Zarejestruj sie")).toHaveAttribute(
      "href",
      "/custom-register"
    );
  });

  it("clears field errors when user types", async () => {
    render(<SignInButton />);

    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));
    expect(
      screen.getByText(
        "Wpisz adres email powiazany z kontem, np. jan@example.com"
      )
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "a");

    expect(
      screen.queryByText(
        "Wpisz adres email powiazany z kontem, np. jan@example.com"
      )
    ).not.toBeInTheDocument();
  });

  it("shows loading state during submission", async () => {
    mockSignInEmail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );

    render(<SignInButton />);

    await user.type(screen.getByLabelText("Email"), "jan@example.com");
    await user.type(screen.getByLabelText("Haslo"), "password123");
    await user.click(screen.getByRole("button", { name: "Zaloguj sie" }));

    expect(
      screen.getByRole("button", { name: "Logowanie..." })
    ).toBeDisabled();
  });
});

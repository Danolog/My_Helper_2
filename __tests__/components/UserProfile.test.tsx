import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserProfile } from "@/components/auth/user-profile";

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
const mockSignOut = vi.fn();
let mockSessionData: {
  data: {
    user: {
      name: string;
      email: string;
      image?: string | null;
    };
  } | null;
  isPending: boolean;
} = {
  data: null,
  isPending: false,
};

vi.mock("@/lib/auth-client", () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
  useSession: () => mockSessionData,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  User: () => <span data-testid="user-icon" />,
  LogOut: () => <span data-testid="logout-icon" />,
}));

describe("UserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionData = { data: null, isPending: false };
  });

  it("shows loading text when session is pending", () => {
    mockSessionData = { data: null, isPending: true };
    render(<UserProfile />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows sign in and sign up links when no session", () => {
    render(<UserProfile />);

    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText("Sign up")).toBeInTheDocument();

    const signInLink = screen.getByText("Sign in").closest("a");
    const signUpLink = screen.getByText("Sign up").closest("a");
    expect(signInLink).toHaveAttribute("href", "/login");
    expect(signUpLink).toHaveAttribute("href", "/register");
  });

  it("renders avatar when user is logged in", () => {
    mockSessionData = {
      data: {
        user: {
          name: "Jan Kowalski",
          email: "jan@example.com",
          image: null,
        },
      },
      isPending: false,
    };

    render(<UserProfile />);

    // The avatar fallback should show the first letter of the name
    expect(screen.getByText("J")).toBeInTheDocument();
  });

  it("shows first letter of email when no name", () => {
    mockSessionData = {
      data: {
        user: {
          name: "",
          email: "jan@example.com",
          image: null,
        },
      },
      isPending: false,
    };

    render(<UserProfile />);

    expect(screen.getByText("J")).toBeInTheDocument();
  });
});

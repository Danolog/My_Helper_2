/**
 * Testy logowania zdarzeń „wysłano link resetu hasła / weryfikacji e-mail"
 * w konfiguracji Better Auth (src/lib/auth.ts).
 *
 * Link resetu hasła i link weryfikacyjny to jednorazowe poświadczenia: kto ma
 * link, ten przejmuje konto. Na produkcji nie mogą trafiać do logów — ani
 * adres URL, ani token, ani pełny adres e-mail. Poza produkcją link zostaje
 * w logu, żeby dało się pracować lokalnie bez dostawcy poczty.
 *
 * Testy wołają PRAWDZIWE funkcje `sendResetPassword` i `sendVerificationEmail`
 * z src/lib/auth.ts — `betterAuth` jest podmieniony tak, by oddawał przekazaną
 * konfigurację.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { loggedText } from "../helpers/logged-text";

// -------------------------------------------------------
// Mocki. vi.mock jest wynoszone nad importy, a fabryki sięgają do zmiennych
// mock* dopiero przy wywołaniu.
// -------------------------------------------------------

vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => ({ options }),
}));

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({}),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockSendPasswordResetEmail = vi.fn();
const mockSendVerificationEmail = vi.fn();
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => false,
  sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
  sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
}));

// -------------------------------------------------------
// Dane testowe
// -------------------------------------------------------

const TOKEN = "tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const USER = { id: "user-123", email: "anna.kowalska@example.com", name: "Anna Kowalska" };
const RESET_URL = `https://app.example.com/reset-password/${TOKEN}?callbackURL=%2Fdashboard`;
const VERIFY_URL = `https://app.example.com/api/auth/verify-email?token=${TOKEN}&callbackURL=%2F`;

type LinkCallback = (data: { user: typeof USER; url: string; token: string }) => Promise<void>;

interface AuthOptionsUnderTest {
  emailAndPassword: { sendResetPassword: LinkCallback };
  emailVerification: { sendVerificationEmail: LinkCallback };
}

const options = (auth as unknown as { options: AuthOptionsUnderTest }).options;
const sendResetPassword = options.emailAndPassword.sendResetPassword;
const sendVerificationEmail = options.emailVerification.sendVerificationEmail;

const mockLoggerInfo = vi.mocked(logger.info);

/** Wszystko, co trafiło do loggera (każdy poziom, błędy z treścią), jako jeden napis. */
function everythingLogged(): string {
  return loggedText(logger);
}

// -------------------------------------------------------
// Testy
// -------------------------------------------------------

describe("auth.ts — logowanie linków resetu hasła i weryfikacji", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendPasswordResetEmail.mockResolvedValue({ success: true });
    mockSendVerificationEmail.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("produkcja (NODE_ENV=production)", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    it("reset hasła: log nie zawiera adresu URL, tokenu ani pełnego e-maila", async () => {
      await sendResetPassword({ user: USER, url: RESET_URL, token: TOKEN });

      expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
      const logged = everythingLogged();
      expect(logged).not.toContain("http");
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(USER.email);
      expect(logged).not.toContain("example.com");
    });

    it("weryfikacja e-mail: log nie zawiera adresu URL, tokenu ani pełnego e-maila", async () => {
      await sendVerificationEmail({ user: USER, url: VERIFY_URL, token: TOKEN });

      expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
      const logged = everythingLogged();
      expect(logged).not.toContain("http");
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(USER.email);
      expect(logged).not.toContain("example.com");
    });

    it("zdarzenie zostaje w logu i wskazuje użytkownika identyfikatorem", async () => {
      await sendResetPassword({ user: USER, url: RESET_URL, token: TOKEN });
      await sendVerificationEmail({ user: USER, url: VERIFY_URL, token: TOKEN });

      expect(mockLoggerInfo).toHaveBeenNthCalledWith(1, "Password reset requested", {
        userId: USER.id,
      });
      expect(mockLoggerInfo).toHaveBeenNthCalledWith(2, "Email verification sent", {
        userId: USER.id,
      });
    });

    it("wysyłka maila dostaje pełny link i adres — zmienia się tylko log", async () => {
      await sendResetPassword({ user: USER, url: RESET_URL, token: TOKEN });
      await sendVerificationEmail({ user: USER, url: VERIFY_URL, token: TOKEN });

      expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({ to: USER.email, url: RESET_URL });
      expect(mockSendVerificationEmail).toHaveBeenCalledWith({ to: USER.email, url: VERIFY_URL });
    });

    it("błąd wysyłki nie dopisuje linku do logu", async () => {
      mockSendPasswordResetEmail.mockRejectedValue(new Error("Resend error: HTTP 500"));

      await expect(
        sendResetPassword({ user: USER, url: RESET_URL, token: TOKEN })
      ).rejects.toThrow("Resend error");

      expect(everythingLogged()).not.toContain(TOKEN);
    });
  });

  describe("poza produkcją", () => {
    it.each(["development", "test"])(
      "NODE_ENV=%s: link resetu i weryfikacji jest w logu (praca lokalna bez dostawcy poczty)",
      async (nodeEnv) => {
        vi.stubEnv("NODE_ENV", nodeEnv);

        await sendResetPassword({ user: USER, url: RESET_URL, token: TOKEN });
        await sendVerificationEmail({ user: USER, url: VERIFY_URL, token: TOKEN });

        expect(mockLoggerInfo).toHaveBeenNthCalledWith(1, "Password reset requested", {
          userId: USER.id,
          email: USER.email,
          resetUrl: RESET_URL,
        });
        expect(mockLoggerInfo).toHaveBeenNthCalledWith(2, "Email verification sent", {
          userId: USER.id,
          email: USER.email,
          verificationUrl: VERIFY_URL,
        });
      }
    );
  });
});

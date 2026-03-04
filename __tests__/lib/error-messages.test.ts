import { describe, it, expect } from "vitest";
import {
  getUserFriendlyMessage,
  sanitizeAuthError,
  sanitizeApiError,
} from "@/lib/error-messages";

describe("getUserFriendlyMessage", () => {
  // --- Auth errors ---
  it("should map 'user already exists' to Polish message", () => {
    const msg = getUserFriendlyMessage(new Error("User already exists"));
    expect(msg).toBe(
      "Konto z tym adresem email juz istnieje. Uzyj innego adresu lub zaloguj sie."
    );
  });

  it("should map 'invalid credentials' to Polish message", () => {
    const msg = getUserFriendlyMessage("Invalid credentials");
    expect(msg).toBe(
      "Nieprawidlowy email lub haslo. Sprawdz dane i sprobuj ponownie."
    );
  });

  it("should map 'invalid email' to Polish message", () => {
    expect(getUserFriendlyMessage("invalid email provided")).toBe(
      "Nieprawidlowy email lub haslo. Sprawdz dane i sprobuj ponownie."
    );
  });

  it("should map 'email not found' to Polish message", () => {
    expect(getUserFriendlyMessage("email does not exist")).toBe(
      "Nie znaleziono konta z tym adresem email."
    );
  });

  it("should map 'password too short' to Polish message", () => {
    expect(getUserFriendlyMessage("password too short")).toBe(
      "Haslo jest za krotkie. Wpisz co najmniej 8 znakow."
    );
  });

  it("should map 'token expired' to Polish message", () => {
    expect(getUserFriendlyMessage("token expired")).toBe(
      "Link wygasl lub jest nieprawidlowy. Sprobuj ponownie."
    );
  });

  it("should map 'email not verified' to Polish message", () => {
    expect(getUserFriendlyMessage("email not verified")).toBe(
      "Adres email nie zostal zweryfikowany. Sprawdz skrzynke pocztowa."
    );
  });

  it("should map 'too many requests' to Polish message", () => {
    expect(getUserFriendlyMessage("Too many requests")).toBe(
      "Zbyt wiele prob. Odczekaj chwile i sprobuj ponownie."
    );
  });

  it("should map 'session expired' to Polish message", () => {
    expect(getUserFriendlyMessage("session expired")).toBe(
      "Sesja wygasla. Zaloguj sie ponownie."
    );
  });

  // --- Network errors ---
  it("should map 'failed to fetch' to network error message", () => {
    expect(getUserFriendlyMessage("Failed to fetch")).toBe(
      "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie."
    );
  });

  it("should map 'ECONNREFUSED' to network error message", () => {
    expect(getUserFriendlyMessage("ECONNREFUSED")).toBe(
      "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie."
    );
  });

  it("should map 'timeout' to timeout message", () => {
    expect(getUserFriendlyMessage("Request timeout")).toBe(
      "Serwer nie odpowiedzial w wymaganym czasie. Sprobuj ponownie pozniej."
    );
  });

  // --- Stripe errors ---
  it("should map stripe-related errors to payment config message", () => {
    expect(getUserFriendlyMessage("Stripe API error")).toBe(
      "Problem z konfiguracja platnosci. Skontaktuj sie z administratorem."
    );
  });

  // --- AI/LLM errors ---
  it("should map AI-related errors to AI unavailable message", () => {
    expect(getUserFriendlyMessage("OpenRouter rate limit exceeded")).toBe(
      "Usluga AI jest chwilowo niedostepna. Sprobuj ponownie za chwile."
    );
  });

  // --- Database errors ---
  it("should map database errors to data save message", () => {
    expect(getUserFriendlyMessage("unique constraint violation on database")).toBe(
      "Wystapil problem z zapisem danych. Sprobuj ponownie."
    );
  });

  // --- CRUD pattern matching ---
  it("should map 'failed to load client' to Polish client fetch message", () => {
    // Note: "Failed to fetch client" would match the network error pattern first
    // because /failed to fetch/ appears before the CRUD patterns. Use "load" instead.
    expect(getUserFriendlyMessage("Failed to load client data")).toBe(
      "Nie udalo sie pobrac danych klienta. Sprobuj ponownie."
    );
  });

  it("should map 'failed to create client' to Polish client create message", () => {
    expect(getUserFriendlyMessage("Failed to create client")).toBe(
      "Nie udalo sie dodac klienta. Sprobuj ponownie."
    );
  });

  it("should map 'failed to update employee' to Polish employee update message", () => {
    expect(getUserFriendlyMessage("Failed to update employee")).toBe(
      "Nie udalo sie zaktualizowac danych pracownika. Sprobuj ponownie."
    );
  });

  it("should map generic 'failed to update' to Polish update message", () => {
    expect(getUserFriendlyMessage("Failed to update records")).toBe(
      "Nie udalo sie zapisac zmian. Sprobuj ponownie."
    );
  });

  it("should map generic 'failed to delete' to Polish delete message", () => {
    expect(getUserFriendlyMessage("Failed to delete item")).toBe(
      "Nie udalo sie usunac. Sprobuj ponownie."
    );
  });

  it("should map generic 'failed to create' to Polish create message", () => {
    expect(getUserFriendlyMessage("Failed to create something")).toBe(
      "Nie udalo sie utworzyc. Sprobuj ponownie."
    );
  });

  it("should map 'unknown error' to Polish message", () => {
    expect(getUserFriendlyMessage("Unknown error")).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should map 'internal server error' to Polish message", () => {
    expect(getUserFriendlyMessage("Internal server error")).toBe(
      "Wystapil blad serwera. Sprobuj ponownie pozniej."
    );
  });

  // --- Edge cases ---
  it("should return fallback for empty string", () => {
    expect(getUserFriendlyMessage("")).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should return fallback for null/undefined/non-string/non-Error input", () => {
    expect(getUserFriendlyMessage(null)).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
    expect(getUserFriendlyMessage(undefined)).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
    expect(getUserFriendlyMessage(42)).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
    expect(getUserFriendlyMessage({})).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should return custom fallback when provided", () => {
    expect(getUserFriendlyMessage(null, "Custom fallback")).toBe(
      "Custom fallback"
    );
  });

  it("should pass through short non-technical messages", () => {
    expect(getUserFriendlyMessage("Cos poszlo nie tak")).toBe(
      "Cos poszlo nie tak"
    );
  });

  it("should filter out technical-looking messages", () => {
    const msg = getUserFriendlyMessage(
      "TypeError: cannot read property 'name' of undefined at Object.handler (/app/src/api/route.ts:15)"
    );
    expect(msg).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should filter out messages with stack traces", () => {
    const msg = getUserFriendlyMessage("Error: at Object.handler (/some/path.ts:10)");
    expect(msg).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should filter out long messages (100+ chars) even if not obviously technical", () => {
    const longMsg = "A".repeat(101);
    expect(getUserFriendlyMessage(longMsg)).toBe(
      "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."
    );
  });

  it("should accept Error objects and extract message", () => {
    const error = new Error("session expired please login again");
    const msg = getUserFriendlyMessage(error);
    expect(msg).toBe("Sesja wygasla. Zaloguj sie ponownie.");
  });
});

describe("sanitizeAuthError", () => {
  it("should return fallback for undefined message", () => {
    expect(sanitizeAuthError(undefined)).toBe(
      "Wystapil blad. Sprobuj ponownie."
    );
  });

  it("should return custom fallback for undefined message", () => {
    expect(sanitizeAuthError(undefined, "Custom")).toBe("Custom");
  });

  it("should sanitize known auth error patterns", () => {
    expect(sanitizeAuthError("user already exists")).toBe(
      "Konto z tym adresem email juz istnieje. Uzyj innego adresu lub zaloguj sie."
    );
  });

  it("should pass through short, non-technical messages", () => {
    expect(sanitizeAuthError("Haslo zmienione")).toBe("Haslo zmienione");
  });
});

describe("sanitizeApiError", () => {
  it("should return fallback for null", () => {
    expect(sanitizeApiError(null, "Fallback")).toBe("Fallback");
  });

  it("should return fallback for undefined", () => {
    expect(sanitizeApiError(undefined, "Fallback")).toBe("Fallback");
  });

  it("should return fallback for empty string", () => {
    expect(sanitizeApiError("", "Fallback")).toBe("Fallback");
  });

  it("should sanitize known error patterns", () => {
    // Note: "Failed to fetch client" matches /failed to fetch/ (network error) first.
    // Use "Failed to load client" to test the CRUD pattern.
    expect(sanitizeApiError("Failed to load client", "Fallback")).toBe(
      "Nie udalo sie pobrac danych klienta. Sprobuj ponownie."
    );
  });

  it("should pass through short user-friendly messages", () => {
    expect(sanitizeApiError("Brak uprawnien", "Fallback")).toBe(
      "Brak uprawnien"
    );
  });
});

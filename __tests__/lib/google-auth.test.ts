import { afterEach, describe, expect, it, vi } from "vitest";
import { getGoogleAuthCredentials, isGoogleAuthConfigured } from "@/lib/google-auth";

describe("getGoogleAuthCredentials / isGoogleAuthConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("obie zmienne ustawione → dane przycięte, configured=true", () => {
    const env = { GOOGLE_CLIENT_ID: "  id.apps.googleusercontent.com ", GOOGLE_CLIENT_SECRET: "secret\n" };

    expect(getGoogleAuthCredentials(env)).toEqual({
      clientId: "id.apps.googleusercontent.com",
      clientSecret: "secret",
    });
    expect(isGoogleAuthConfigured(env)).toBe(true);
  });

  it("pusty identyfikator → null", () => {
    const env = { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "secret" };

    expect(getGoogleAuthCredentials(env)).toBeNull();
    expect(isGoogleAuthConfigured(env)).toBe(false);
  });

  it("pusty sekret → null", () => {
    const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "" };

    expect(getGoogleAuthCredentials(env)).toBeNull();
    expect(isGoogleAuthConfigured(env)).toBe(false);
  });

  it("same białe znaki → null", () => {
    const env = { GOOGLE_CLIENT_ID: "   ", GOOGLE_CLIENT_SECRET: "\t\n" };

    expect(getGoogleAuthCredentials(env)).toBeNull();
    expect(isGoogleAuthConfigured(env)).toBe(false);
  });

  it("brak obu zmiennych → null", () => {
    expect(getGoogleAuthCredentials({})).toBeNull();
    expect(isGoogleAuthConfigured({})).toBe(false);
  });

  it("brak jednej zmiennej → null", () => {
    expect(isGoogleAuthConfigured({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(isGoogleAuthConfigured({ GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });

  it("bez argumentu czyta process.env w chwili wywołania", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(isGoogleAuthConfigured()).toBe(false);

    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect(isGoogleAuthConfigured()).toBe(true);
  });
});

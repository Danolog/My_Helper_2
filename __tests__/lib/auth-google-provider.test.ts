// @vitest-environment node
/**
 * Produkcyjne auth.ts rejestruje dostawcę Google wyłącznie przy komplecie
 * GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET. Bez nich `/sign-in/social` z
 * `provider: "google"` kończy się błędem PROVIDER_NOT_FOUND (404), a nie
 * przekierowaniem do Google z pustym client_id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Konfiguracja nie może dotknąć bazy: pula systemowa i surowe db to atrapy.
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));

type AuthModule = typeof import("@/lib/auth");

async function loadAuth(env: { id: string; secret: string }): Promise<AuthModule["auth"]> {
  vi.stubEnv("GOOGLE_CLIENT_ID", env.id);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", env.secret);
  vi.resetModules();
  const mod: AuthModule = await import("@/lib/auth");
  return mod.auth;
}

function configuredProviderKeys(auth: AuthModule["auth"]): string[] {
  const options = auth.options as { socialProviders?: Record<string, unknown> };
  return Object.keys(options.socialProviders ?? {});
}

async function registeredProviderIds(auth: AuthModule["auth"]): Promise<string[]> {
  const ctx = (await auth.$context) as unknown as { socialProviders: { id: string }[] };
  return ctx.socialProviders.map((p) => p.id);
}

describe("auth.ts: dostawca Google", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bez zmiennych: google nie jest w konfiguracji ani w kontekście", async () => {
    const auth = await loadAuth({ id: "", secret: "" });

    expect(configuredProviderKeys(auth)).toEqual([]);
    expect(await registeredProviderIds(auth)).not.toContain("google");
  });

  it("tylko identyfikator (sekret z białych znaków): google nie jest rejestrowany", async () => {
    const auth = await loadAuth({ id: "client-id", secret: "   " });

    expect(configuredProviderKeys(auth)).toEqual([]);
  });

  it("bez zmiennych: /sign-in/social google → PROVIDER_NOT_FOUND, bez adresu Google", async () => {
    const auth = await loadAuth({ id: "", secret: "" });

    await expect(
      auth.api.signInSocial({ body: { provider: "google", callbackURL: "/" } })
    ).rejects.toMatchObject({
      statusCode: 404,
      body: expect.objectContaining({ code: "PROVIDER_NOT_FOUND" }),
    });
  });

  it("obie zmienne ustawione: google zarejestrowany z przyciętymi danymi", async () => {
    const auth = await loadAuth({ id: " client-id ", secret: "client-secret\n" });

    const options = auth.options as {
      socialProviders?: { google?: { clientId: string; clientSecret: string } };
    };
    expect(options.socialProviders?.google).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(await registeredProviderIds(auth)).toContain("google");
  });
});

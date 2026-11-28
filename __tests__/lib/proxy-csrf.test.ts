// @vitest-environment node
/**
 * Odmowy CSRF w `src/proxy.ts`: mutacja API bez tokenu albo ze złym tokenem
 * dostaje 403 z polem `code` (`CSRF_MISSING` / `CSRF_INVALID`) i jednym,
 * wspólnym polskim tekstem dla użytkownika. Poprawny token przechodzi dalej.
 */
import { NextRequest } from "next/server";
import { describe, it, expect } from "vitest";
import {
  CSRF_HEADER,
  CSRF_SECRET_COOKIE,
  generateSecret,
  hmacSign,
} from "@/lib/csrf";
import { CSRF_REJECTED_MESSAGE, proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
// Trasa rdzenia (niezamrożona), objęta kontrolą CSRF.
const ROUTE = "/api/clients";
const SESSION = "better-auth.session_token=test-session";
const MUTATIONS = ["POST", "PUT", "PATCH", "DELETE"] as const;

const EXPECTED_MESSAGE =
  "Nie udało się wysłać formularza. Odśwież stronę i spróbuj ponownie. Jeśli błąd wróci, zamknij przeglądarkę i otwórz ją ponownie.";

function mutation(
  method: string,
  options: { secret?: string; token?: string } = {}
): NextRequest {
  const cookies = [SESSION];
  if (options.secret) cookies.push(`${CSRF_SECRET_COOKIE}=${options.secret}`);
  const headers: Record<string, string> = { cookie: cookies.join("; ") };
  if (options.token) headers[CSRF_HEADER] = options.token;
  return new NextRequest(`${ORIGIN}${ROUTE}`, { method, headers });
}

/** Odpowiedź „przepuść dalej” z NextResponse.next(). */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("proxy: odmowy CSRF", () => {
  it("tekst odmowy to brzmienie uzgodnione z produktem", () => {
    expect(CSRF_REJECTED_MESSAGE).toBe(EXPECTED_MESSAGE);
  });

  it.each(MUTATIONS)("%s bez nagłówka tokenu → 403 CSRF_MISSING", async (method) => {
    const response = await proxy(mutation(method, { secret: generateSecret() }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      code: "CSRF_MISSING",
      error: EXPECTED_MESSAGE,
    });
  });

  it("nagłówek tokenu bez ciasteczka csrf-secret → 403 CSRF_MISSING", async () => {
    const token = await hmacSign(generateSecret());
    const response = await proxy(mutation("POST", { token }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      code: "CSRF_MISSING",
      error: EXPECTED_MESSAGE,
    });
  });

  it.each(MUTATIONS)("%s ze złym tokenem → 403 CSRF_INVALID", async (method) => {
    const response = await proxy(
      mutation(method, { secret: generateSecret(), token: "zly-token" })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      code: "CSRF_INVALID",
      error: EXPECTED_MESSAGE,
    });
  });

  it("token podpisany dla innego csrf-secret → 403 CSRF_INVALID", async () => {
    const token = await hmacSign(generateSecret());
    const response = await proxy(mutation("POST", { secret: generateSecret(), token }));

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_INVALID");
  });

  it.each(MUTATIONS)("%s z poprawnym tokenem przechodzi dalej", async (method) => {
    const secret = generateSecret();
    const token = await hmacSign(secret);
    const response = await proxy(mutation(method, { secret, token }));

    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });
});

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "./auth";

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export interface AuthResult {
  session: Session;
  user: Session["user"];
}

/**
 * Require authenticated session.
 * Returns AuthResult on success, or NextResponse (401) on failure.
 *
 * Celowo BEZ parametru roli: user.role nie jest uprawnieniem (na produkcji
 * "owner" ma jedno konto). Uprawnienia w salonie => requireSalonStaff
 * (salons.ownerId / employees.role); admin platformy => requirePlatformAdmin.
 *
 * Usage:
 *   const authResult = await requireAuth();
 *   if (isAuthError(authResult)) return authResult;
 *   const { user } = authResult;
 */
export async function requireAuth(): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Wymagane logowanie" },
      { status: 401 }
    );
  }

  return { session, user: session.user };
}

/**
 * Admin PLATFORMY (narzędzia operacyjne, np. /api/diagnostics) — jawna lista
 * e-maili z env ADMIN_EMAILS (po przecinku, bez rozróżniania wielkości liter).
 * Pusta/nieustawiona lista => nikt. NIE używa user.role: rola konta nie
 * oznacza admina platformy (na produkcji "owner" ma jedno konto właściciela
 * salonu), a własność salonu to salons.ownerId.
 *
 * Na liście umieszczaj tylko e-maile ISTNIEJĄCYCH kont — e-mail jest unikalny,
 * więc nikt inny nie zarejestruje się na zajęty adres.
 */
export async function requirePlatformAdmin(): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Wymagane logowanie" },
      { status: 401 }
    );
  }

  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = session.user.email?.trim().toLowerCase();

  if (!email || !admins.includes(email)) {
    return NextResponse.json(
      { success: false, error: "Brak uprawnień" },
      { status: 403 }
    );
  }

  return { session, user: session.user };
}

/** Type guard: returns true when requireAuth returned an error response */
export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Require valid CRON_SECRET header for cron/system endpoints.
 * Returns null on success, or NextResponse (401) on failure.
 */
export async function requireCronSecret(request: Request): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  // Porównanie czasowo-stałe zamiast `===` — nie wyciekamy sekretu przez czas porównania.
  // timingSafeEqual rzuca przy różnych długościach, więc najpierw guard na długość.
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}

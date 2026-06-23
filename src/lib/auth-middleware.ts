import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { auth } from "./auth";

type UserRole = "owner" | "employee" | "receptionist" | "client";

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export interface AuthResult {
  session: Session;
  user: Session["user"];
}

/**
 * Require authenticated session. Optionally check user role.
 * Returns AuthResult on success, or NextResponse (401/403) on failure.
 *
 * Usage:
 *   const authResult = await requireAuth();
 *   if (isAuthError(authResult)) return authResult;
 *   const { user } = authResult;
 */
export async function requireAuth(requiredRole?: UserRole): Promise<AuthResult | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json(
      { success: false, error: "Wymagane logowanie" },
      { status: 401 }
    );
  }

  if (requiredRole) {
    const userRole = (session.user as Record<string, unknown>).role as string | undefined;
    if (userRole !== requiredRole) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnień" },
        { status: 403 }
      );
    }
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

  // Porównanie czasowo-stałe (timingSafeEqual) zamiast `===`, by nie wyciekać sekretu
  // przez czas porównania (#14 LOW, review Ryana). Guard na równą długość: timingSafeEqual
  // rzuca na różnych długościach, więc najpierw sprawdzamy długość (sam fakt różnicy długości
  // i tak nie zdradza zawartości sekretu).
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}

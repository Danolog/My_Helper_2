import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { temporaryAccess, employees, salons } from "@/lib/schema";
import { eq, and, gt, lt, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Available feature names that can be granted temporarily.
 * These correspond to dashboard sections that employees/receptionists
 * can receive temporary access to from the salon owner.
 */
const VALID_FEATURES = [
  "reports",
  "settings",
  "employees",
  "finance",
  "promotions",
  "products",
  "invoices",
  "content-generator",
  "subscription",
  "gallery-manage",
  "clients-delete",
] as const;

/**
 * Clean up expired temporary access entries.
 * Called automatically on GET and POST to keep the table tidy.
 */
async function cleanupExpiredAccess(): Promise<number> {
  const now = new Date();
  const expired = await db
    .delete(temporaryAccess)
    .where(lt(temporaryAccess.expiresAt, now))
    .returning({ id: temporaryAccess.id });

  if (expired.length > 0) {
    console.log(
      `[Temporary Access] Cleaned up ${expired.length} expired access entries`
    );
  }

  return expired.length;
}

// GET /api/temporary-access - List active temporary access grants
// Query params: userId (optional - filter by user)
export async function GET(request: Request) {
  try {
    // Verify the caller is authenticated
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    // Clean up expired entries first
    await cleanupExpiredAccess();

    // Resolve the caller's salon to scope results
    const [callerSalon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, session.user.id))
      .limit(1);

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    const now = new Date();

    // Build query for active (non-expired) grants only, scoped to caller's salon
    let grants: (typeof temporaryAccess.$inferSelect)[];
    if (userId) {
      grants = await db
        .select()
        .from(temporaryAccess)
        .where(
          and(
            eq(temporaryAccess.userId, userId),
            gt(temporaryAccess.expiresAt, now)
          )
        );
    } else if (callerSalon) {
      // Scope to only employees belonging to the caller's salon
      const salonEmployeeIds = await db
        .select({ userId: employees.userId })
        .from(employees)
        .where(eq(employees.salonId, callerSalon.id));

      const userIds = salonEmployeeIds
        .map((e) => e.userId)
        .filter((id): id is string => id !== null);

      if (userIds.length === 0) {
        grants = [];
      } else {
        grants = await db
          .select()
          .from(temporaryAccess)
          .where(
            and(
              inArray(temporaryAccess.userId, userIds),
              gt(temporaryAccess.expiresAt, now)
            )
          );
      }
    } else {
      // No salon found - return empty results
      grants = [];
    }

    console.log(
      `[Temporary Access] Found ${grants.length} active grants${userId ? ` for user ${userId}` : ""}`
    );

    return NextResponse.json({
      success: true,
      data: grants,
      count: grants.length,
    });
  } catch (error) {
    console.error("[Temporary Access] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udało się pobrać uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}

// POST /api/temporary-access - Grant temporary access to a user
// Body: { userId, featureName, durationMinutes }
export async function POST(request: Request) {
  try {
    // Verify the caller is authenticated and is a salon owner
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    // Verify the caller is a salon owner (only owners can grant access)
    const [salon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, session.user.id))
      .limit(1);

    const userRole = (session.user as { role?: string }).role;
    const isOwner =
      userRole === "admin" || userRole === "owner" || !!salon;

    if (!isOwner) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tylko wlasciciel salonu moze nadawac czasowy dostep",
        },
        { status: 403 }
      );
    }

    // Clean up expired entries
    await cleanupExpiredAccess();

    // Parse and validate body
    let body: {
      userId?: string;
      featureName?: string;
      durationMinutes?: number;
    } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowe dane żądania" },
        { status: 400 }
      );
    }

    const { userId, featureName, durationMinutes } = body;

    // Validate required fields
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId jest wymagane" },
        { status: 400 }
      );
    }

    if (!featureName) {
      return NextResponse.json(
        { success: false, error: "featureName jest wymagane" },
        { status: 400 }
      );
    }

    if (
      !VALID_FEATURES.includes(featureName as (typeof VALID_FEATURES)[number])
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Nieprawidlowa funkcja. Dostepne: ${VALID_FEATURES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (!durationMinutes || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) {
      // Max 30 days (43200 minutes)
      return NextResponse.json(
        {
          success: false,
          error:
            "durationMinutes musi byc liczba od 1 do 43200 (maksymalnie 30 dni)",
        },
        { status: 400 }
      );
    }

    // Verify the target user exists as an employee in the owner's salon
    if (salon) {
      const [employee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.userId, userId),
            eq(employees.salonId, salon.id)
          )
        )
        .limit(1);

      if (!employee) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Uzytkownik nie jest pracownikiem tego salonu",
          },
          { status: 404 }
        );
      }
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    // Check if there's already an active grant for this user+feature
    const now = new Date();
    const [existing] = await db
      .select()
      .from(temporaryAccess)
      .where(
        and(
          eq(temporaryAccess.userId, userId),
          eq(temporaryAccess.featureName, featureName),
          gt(temporaryAccess.expiresAt, now)
        )
      )
      .limit(1);

    if (existing) {
      // Update the existing grant with new expiration
      const [updated] = await db
        .update(temporaryAccess)
        .set({ expiresAt, grantedBy: session.user.id })
        .where(eq(temporaryAccess.id, existing.id))
        .returning();

      console.log(
        `[Temporary Access] Updated grant for user ${userId}: ${featureName} until ${expiresAt.toISOString()}`
      );

      return NextResponse.json({
        success: true,
        data: updated,
        message: "Czasowy dostep zostal zaktualizowany",
      });
    }

    // Create new grant
    const [grant] = await db
      .insert(temporaryAccess)
      .values({
        userId,
        featureName,
        grantedBy: session.user.id,
        expiresAt,
      })
      .returning();

    console.log(
      `[Temporary Access] Granted ${featureName} to user ${userId} until ${expiresAt.toISOString()} by ${session.user.email}`
    );

    return NextResponse.json(
      {
        success: true,
        data: grant,
        message: "Czasowy dostep zostal nadany",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Temporary Access] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udało się nadać uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}

// DELETE /api/temporary-access - Revoke temporary access
// Body: { grantId } or query param: ?grantId=xxx
export async function DELETE(request: Request) {
  try {
    // Verify the caller is authenticated
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    // Verify the caller is a salon owner
    const [salon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, session.user.id))
      .limit(1);

    const userRole = (session.user as { role?: string }).role;
    const isOwner =
      userRole === "admin" || userRole === "owner" || !!salon;

    if (!isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: "Tylko wlasciciel salonu moze cofnac czasowy dostep",
        },
        { status: 403 }
      );
    }

    // Get grantId from query params or body
    const { searchParams } = new URL(request.url);
    let grantId = searchParams.get("grantId");

    if (!grantId) {
      try {
        const body = await request.json();
        grantId = body.grantId;
      } catch {
        // Body parsing failed
      }
    }

    if (!grantId) {
      return NextResponse.json(
        { success: false, error: "grantId jest wymagane" },
        { status: 400 }
      );
    }

    // Fetch the grant first to verify ownership
    const [grant] = await db
      .select()
      .from(temporaryAccess)
      .where(eq(temporaryAccess.id, grantId))
      .limit(1);

    if (!grant) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono uprawnienia" },
        { status: 404 }
      );
    }

    // Verify the grant's userId belongs to an employee of the caller's salon
    if (salon) {
      const [employee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.userId, grant.userId),
            eq(employees.salonId, salon.id)
          )
        )
        .limit(1);

      if (!employee) {
        return NextResponse.json(
          { success: false, error: "To uprawnienie nie nalezy do pracownika Twojego salonu" },
          { status: 403 }
        );
      }
    }

    const [deleted] = await db
      .delete(temporaryAccess)
      .where(eq(temporaryAccess.id, grantId))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono uprawnienia" },
        { status: 404 }
      );
    }

    console.log(
      `[Temporary Access] Revoked grant ${grantId} (${deleted.featureName} for user ${deleted.userId}) by ${session.user.email}`
    );

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Czasowy dostep zostal cofniety",
    });
  } catch (error) {
    console.error("[Temporary Access] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udało się cofnąć uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}

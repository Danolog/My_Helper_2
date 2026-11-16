import { NextResponse } from "next/server";
import { eq, and, gt, lt } from "drizzle-orm";
import { validateBody, temporaryAccessSchema } from "@/lib/api-validation";
// ADR-001: temporary_access nie ma salon_id (zawężenie po granted_by = właściciel
// salonu z sesji) — świadomie surowe db, warunki salonu jawnie w WHERE.
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireSalonStaff, type SalonContext } from "@/lib/salon-context";
import { temporaryAccess, employees } from "@/lib/schema";

/**
 * Uprawnienia (bez user.role — na produkcji rola "owner" jest tylko na części
 * kont): nadaje, cofa i listuje WYŁĄCZNIE właściciel salonu z kontekstu sesji
 * (salons.ownerId). Grant należy do salonu, którego właściciel go nadał
 * (granted_by) — tabela nie ma kolumny salon_id (docelowo migracja).
 */
async function requireSalonOwner(
  forbiddenMessage: string
): Promise<{ ctx: SalonContext; error?: undefined } | { ctx?: undefined; error: NextResponse }> {
  const gate = await requireSalonStaff();
  if (gate.error) return gate;
  if (gate.ctx.role !== "owner") {
    return {
      error: NextResponse.json({ success: false, error: forbiddenMessage }, { status: 403 }),
    };
  }
  return { ctx: gate.ctx };
}

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
    logger.info(`[Temporary Access] Cleaned up ${expired.length} expired access entries`);
  }

  return expired.length;
}

// GET /api/temporary-access - List active temporary access grants of the
// caller's salon (granted by its owner). Query params: userId (optional filter)
export async function GET(request: Request) {
  try {
    const gate = await requireSalonOwner(
      "Tylko wlasciciel salonu moze przegladac czasowe dostepy"
    );
    if (gate.error) return gate.error;
    const { ctx } = gate;

    // Clean up expired entries first
    await cleanupExpiredAccess();

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    const now = new Date();

    // Tylko granty nadane przez właściciela salonu z sesji (ctx.userId =
    // salons.ownerId). ?userId= zawęża dalej, nigdy nie wychodzi poza salon.
    const grants = await db
      .select()
      .from(temporaryAccess)
      .where(
        and(
          eq(temporaryAccess.grantedBy, ctx.userId),
          ...(userId ? [eq(temporaryAccess.userId, userId)] : []),
          gt(temporaryAccess.expiresAt, now)
        )
      );

    logger.info(`[Temporary Access] Found ${grants.length} active grants${userId ? ` for user ${userId}` : ""}`);

    return NextResponse.json({
      success: true,
      data: grants,
      count: grants.length,
    });
  } catch (error) {
    logger.error("[Temporary Access] Database error", { error: error });
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
    // Only the owner of the session's salon can grant access
    const gate = await requireSalonOwner(
      "Tylko wlasciciel salonu moze nadawac czasowy dostep"
    );
    if (gate.error) return gate.error;
    const { ctx } = gate;

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

    const validationError = validateBody(temporaryAccessSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const userId = body.userId!;
    const featureName = body.featureName!;
    const durationMinutes = body.durationMinutes;

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

    // The target must ALWAYS be an employee of the session's salon
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.userId, userId),
          eq(employees.salonId, ctx.salonId)
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

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    // Check if there's already an active grant for this user+feature IN THIS
    // salon (granted_by = owner) — a grant from another salon is never
    // updated/taken over.
    const now = new Date();
    const [existing] = await db
      .select()
      .from(temporaryAccess)
      .where(
        and(
          eq(temporaryAccess.userId, userId),
          eq(temporaryAccess.featureName, featureName),
          eq(temporaryAccess.grantedBy, ctx.userId),
          gt(temporaryAccess.expiresAt, now)
        )
      )
      .limit(1);

    if (existing) {
      // Update the existing grant with new expiration
      const [updated] = await db
        .update(temporaryAccess)
        .set({ expiresAt })
        .where(eq(temporaryAccess.id, existing.id))
        .returning();

      logger.info(`[Temporary Access] Updated grant for user ${userId}: ${featureName} until ${expiresAt.toISOString()}`);

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
        grantedBy: ctx.userId,
        expiresAt,
      })
      .returning();

    logger.info(`[Temporary Access] Granted ${featureName} to user ${userId} until ${expiresAt.toISOString()} by owner ${ctx.userId} (salon ${ctx.salonId})`);

    return NextResponse.json(
      {
        success: true,
        data: grant,
        message: "Czasowy dostep zostal nadany",
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Temporary Access] Database error", { error: error });
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
    // Only the owner of the session's salon can revoke access
    const gate = await requireSalonOwner(
      "Tylko wlasciciel salonu moze cofnac czasowy dostep"
    );
    if (gate.error) return gate.error;
    const { ctx } = gate;

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

    // Fetch the grant scoped to the session's salon (granted_by = owner);
    // a grant from another salon is invisible (404, no existence disclosure).
    const [grant] = await db
      .select()
      .from(temporaryAccess)
      .where(
        and(
          eq(temporaryAccess.id, grantId),
          eq(temporaryAccess.grantedBy, ctx.userId)
        )
      )
      .limit(1);

    if (!grant) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono uprawnienia" },
        { status: 404 }
      );
    }

    const [deleted] = await db
      .delete(temporaryAccess)
      .where(
        and(
          eq(temporaryAccess.id, grantId),
          eq(temporaryAccess.grantedBy, ctx.userId)
        )
      )
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono uprawnienia" },
        { status: 404 }
      );
    }

    logger.info(`[Temporary Access] Revoked grant ${grantId} (${deleted.featureName} for user ${deleted.userId}) by owner ${ctx.userId}`);

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Czasowy dostep zostal cofniety",
    });
  } catch (error) {
    logger.error("[Temporary Access] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udało się cofnąć uprawnień tymczasowych" },
      { status: 500 }
    );
  }
}

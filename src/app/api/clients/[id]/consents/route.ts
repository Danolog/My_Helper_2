import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { marketingConsents, clients } from "@/lib/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { validateBody, clientConsentsSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
const VALID_CONSENT_TYPES = ["email", "sms", "phone"] as const;
type ConsentType = (typeof VALID_CONSENT_TYPES)[number];

interface ConsentStatus {
  type: ConsentType;
  granted: boolean;
  grantedAt: string | null;
}

/**
 * GET /api/clients/[id]/consents
 *
 * Returns the current marketing consent status for a client.
 * Each consent type (email, sms, phone) has a granted/not granted status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const { id: clientId } = await params;

  try {
    // Verify client exists
    const [client] = await db
      .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return Response.json({ error: "Klient nie zostal znaleziony" }, { status: 404 });
    }

    // Get all active consents for this client+salon
    const activeConsents = await db
      .select({
        consentType: marketingConsents.consentType,
        grantedAt: marketingConsents.grantedAt,
      })
      .from(marketingConsents)
      .where(
        and(
          eq(marketingConsents.clientId, clientId),
          eq(marketingConsents.salonId, salonId),
          isNull(marketingConsents.revokedAt)
        )
      );

    // Build consent status for each type
    const consentMap = new Map<string, Date>();
    for (const consent of activeConsents) {
      consentMap.set(consent.consentType, consent.grantedAt);
    }

    const consents: ConsentStatus[] = VALID_CONSENT_TYPES.map((type) => ({
      type,
      granted: consentMap.has(type),
      grantedAt: consentMap.has(type) ? consentMap.get(type)!.toISOString() : null,
    }));

    return Response.json({
      clientId: client.id,
      clientName: `${client.firstName} ${client.lastName}`,
      consents,
    });
  } catch (error) {
    logger.error("[Client Consents] GET Error", { error: error });
    return Response.json(
      { error: "Blad podczas pobierania zgod marketingowych" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clients/[id]/consents
 *
 * Update marketing consent status for a client.
 * Body: { consents: { email: boolean, sms: boolean, phone: boolean } }
 *
 * When granting consent: creates a new record with grantedAt = now
 * When revoking consent: sets revokedAt = now on existing active record
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const { id: clientId } = await params;

  try {
    const body = await request.json();
    const validationError = validateBody(clientConsentsSchema, body);
    if (validationError) {
      return Response.json(validationError, { status: 400 });
    }
    const { consents } = body as { consents: Record<string, boolean> };

    // Verify client exists
    const [client] = await db
      .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return Response.json({ error: "Klient nie zostal znaleziony" }, { status: 404 });
    }

    // Get current active consents
    const activeConsents = await db
      .select({
        id: marketingConsents.id,
        consentType: marketingConsents.consentType,
        grantedAt: marketingConsents.grantedAt,
      })
      .from(marketingConsents)
      .where(
        and(
          eq(marketingConsents.clientId, clientId),
          eq(marketingConsents.salonId, salonId),
          isNull(marketingConsents.revokedAt)
        )
      );

    const activeConsentMap = new Map<string, string>(); // type -> id
    for (const consent of activeConsents) {
      activeConsentMap.set(consent.consentType, consent.id);
    }

    const now = new Date();

    // Process each consent type
    for (const type of VALID_CONSENT_TYPES) {
      const shouldBeGranted = consents[type];
      if (shouldBeGranted === undefined) continue; // Skip if not provided

      const isCurrentlyGranted = activeConsentMap.has(type);

      if (shouldBeGranted && !isCurrentlyGranted) {
        // Grant new consent
        await db.insert(marketingConsents).values({
          clientId,
          salonId: salonId,
          consentType: type,
          grantedAt: now,
        });
        logger.info(`[Client Consents] Granted ${type} consent for client ${clientId}`);
      } else if (!shouldBeGranted && isCurrentlyGranted) {
        // Revoke existing consent
        const consentId = activeConsentMap.get(type)!;
        await db
          .update(marketingConsents)
          .set({ revokedAt: now })
          .where(eq(marketingConsents.id, consentId));
        logger.info(`[Client Consents] Revoked ${type} consent for client ${clientId}`);
      }
      // If shouldBeGranted === isCurrentlyGranted, no change needed
    }

    // Re-fetch to return updated status
    const updatedConsents = await db
      .select({
        consentType: marketingConsents.consentType,
        grantedAt: marketingConsents.grantedAt,
      })
      .from(marketingConsents)
      .where(
        and(
          eq(marketingConsents.clientId, clientId),
          eq(marketingConsents.salonId, salonId),
          isNull(marketingConsents.revokedAt)
        )
      );

    const updatedMap = new Map<string, Date>();
    for (const consent of updatedConsents) {
      updatedMap.set(consent.consentType, consent.grantedAt);
    }

    const result: ConsentStatus[] = VALID_CONSENT_TYPES.map((type) => ({
      type,
      granted: updatedMap.has(type),
      grantedAt: updatedMap.has(type) ? updatedMap.get(type)!.toISOString() : null,
    }));

    return Response.json({
      success: true,
      clientId: client.id,
      clientName: `${client.firstName} ${client.lastName}`,
      consents: result,
    });
  } catch (error) {
    logger.error("[Client Consents] PUT Error", { error: error });
    return Response.json(
      { error: "Blad podczas aktualizacji zgod marketingowych" },
      { status: 500 }
    );
  }
}

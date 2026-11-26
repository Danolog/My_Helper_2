import { NextResponse } from "next/server";
import { eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createClientSchema } from "@/lib/api-validation";
import { DEPOSITS_DISABLED_CODE, DEPOSITS_DISABLED_MESSAGE, isDepositEnabled } from "@/lib/features";
import { healthDataConsentRequiredBody, normalizeAllergies } from "@/lib/health-data-consent";
import { logger } from "@/lib/logger";
import { getSalonContext } from "@/lib/salon-context";
import { apiRateLimit } from "@/lib/rate-limit";
import { clients, appointments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// GET /api/clients - List clients of the caller's salon with optional filtering
// (salon is derived from the session — ADR-001 tenant isolation)
// Supported query params:
//   dateAddedFrom  - clients added on or after this ISO date
//   dateAddedTo    - clients added on or before this ISO date
//   lastVisitFrom  - clients whose last visit is on or after this ISO date
//   lastVisitTo    - clients whose last visit is on or before this ISO date
//   hasAllergies   - "true" to return only clients with allergies set
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Clients API] GET",
    errorMessage: "Failed to fetch clients",
  },
  async ({ request }) => {
    // Tenant isolation (ADR-001): derive the salon from the session, never
    // trust a client-supplied salonId in the query string (IDOR risk).
    // Faza 3 (role): kartoteka klientów dla owner/receptionist; employee 403.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (ctx.role === "employee") {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }
    const salonId = ctx.salonId;

    const { searchParams } = new URL(request.url);
    const dateAddedFrom = searchParams.get("dateAddedFrom");
    const dateAddedTo = searchParams.get("dateAddedTo");
    const lastVisitFrom = searchParams.get("lastVisitFrom");
    const lastVisitTo = searchParams.get("lastVisitTo");
    const hasAllergies = searchParams.get("hasAllergies");

    logger.info("[Clients API] GET with params", {
      salonId,
      dateAddedFrom,
      dateAddedTo,
      lastVisitFrom,
      lastVisitTo,
      hasAllergies,
    });

    const result = await forSalon(salonId).raw((tx) => {
      // Subquery: compute the most recent appointment start_time per client
      const lastVisitSubquery = tx
        .select({
          clientId: appointments.clientId,
          lastVisit: sql<string>`MAX(${appointments.startTime})`.as("last_visit"),
        })
        .from(appointments)
        .where(eq(appointments.salonId, salonId))
        .groupBy(appointments.clientId)
        .as("last_visit_sq");

      // Accumulate WHERE conditions dynamically (salon scope always applied)
      const conditions = [eq(clients.salonId, salonId)];

      if (dateAddedFrom) {
        conditions.push(gte(clients.createdAt, new Date(dateAddedFrom)));
      }

      if (dateAddedTo) {
        conditions.push(lte(clients.createdAt, new Date(dateAddedTo)));
      }

      if (lastVisitFrom) {
        conditions.push(gte(lastVisitSubquery.lastVisit, lastVisitFrom));
      }

      if (lastVisitTo) {
        conditions.push(lte(lastVisitSubquery.lastVisit, lastVisitTo));
      }

      if (hasAllergies === "true") {
        conditions.push(isNotNull(clients.allergies));
      }

      // Base query: select all client fields plus the computed lastVisit
      return tx
        .select({
          client: clients,
          lastVisit: lastVisitSubquery.lastVisit,
        })
        .from(clients)
        .leftJoin(lastVisitSubquery, eq(clients.id, lastVisitSubquery.clientId))
        .where(and(...conditions))
        // Twardy cap — kartoteka bez limitu ladowala wszystkich klientow salonu
        .limit(2000);
    });
    logger.info(`[Clients API] Query returned ${result.length} rows`);

    // Flatten: spread client fields and attach lastVisit at the top level
    const data = result.map((row) => ({
      ...row.client,
      lastVisit: row.lastVisit ?? null,
    }));

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
    });
  }
);

// POST /api/clients - Create a new client
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    schema: createClientSchema as z.ZodType<{
      salonId: string;
      firstName: string;
      lastName: string;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
      preferences?: string | null;
      allergies?: string | null;
      healthDataConsent?: boolean;
      favoriteEmployeeId?: string | null;
      requireDeposit?: boolean;
      depositType?: "percentage" | "fixed";
      depositValue?: string | null;
    }>,
    logLabel: "[Clients API] POST",
    errorMessage: "Failed to create client",
  },
  async ({ body }) => {
    const { salonId, firstName, lastName, phone, email, notes, preferences, allergies, healthDataConsent, favoriteEmployeeId, requireDeposit, depositType, depositValue } = body;

    // Faza 3 (role): dodawanie klientów dla owner/receptionist; employee 403.
    // Recepcja tylko we WŁASNYM salonie (salonId z body musi zgadzać się z sesją).
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    // UAT X-1: salonId z body musi zgadzac sie z sesja dla KAZDEJ roli
    // (wczesniej owner byl zwolniony z dopasowania -> zapis cross-tenant).
    // Employee nie moze dodawac klientow.
    if (ctx.role === "employee" || salonId !== ctx.salonId) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    // Zadatek wyłączony (isDepositEnabled): klient z wymogiem zadatku nie powstaje.
    if (requireDeposit === true && !isDepositEnabled()) {
      return NextResponse.json(
        { success: false, code: DEPOSITS_DISABLED_CODE, error: DEPOSITS_DISABLED_MESSAGE },
        { status: 409 }
      );
    }

    // Informacja o zdrowiu tylko przy wyraźnej zgodzie (DPA §4). Pusty napis
    // to brak informacji, więc przechodzi bez zgody i zapisuje się jako NULL.
    const allergiesValue = normalizeAllergies(allergies) ?? null;
    const consentGiven = healthDataConsent === true;
    if (allergiesValue !== null && !consentGiven) {
      return NextResponse.json(healthDataConsentRequiredBody(), { status: 400 });
    }

    logger.info(`[Clients API] Executing: INSERT INTO clients (salon_id, first_name, last_name, phone, email, notes, preferences, allergies, health_data_consent_at, health_data_consent_by, favorite_employee_id)`);
    const [newClient] = await forSalon(salonId).raw((tx) =>
      tx
      .insert(clients)
      .values({
        salonId,
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        preferences: preferences || null,
        allergies: allergiesValue,
        // Czas bazy i konto z sesji — nigdy wartości z body.
        healthDataConsentAt: consentGiven ? sql`now()` : null,
        healthDataConsentBy: consentGiven ? ctx.userId : null,
        favoriteEmployeeId: favoriteEmployeeId || null,
        requireDeposit: requireDeposit || false,
        depositType: depositType || "percentage",
        depositValue: depositValue || null,
      })
      .returning()
    );

    logger.info(`[Clients API] INSERT successful, created client with id: ${newClient?.id}`);

    return NextResponse.json({
      success: true,
      data: newClient,
    }, { status: 201 });
  }
);

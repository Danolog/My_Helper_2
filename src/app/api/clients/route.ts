import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients, appointments } from "@/lib/schema";
import { eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";
import { validateBody, createClientSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/clients - List all clients with optional filtering
// Supported query params:
//   salonId        - filter by salon
//   dateAddedFrom  - clients added on or after this ISO date
//   dateAddedTo    - clients added on or before this ISO date
//   lastVisitFrom  - clients whose last visit is on or after this ISO date
//   lastVisitTo    - clients whose last visit is on or before this ISO date
//   hasAllergies   - "true" to return only clients with allergies set
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateAddedFrom = searchParams.get("dateAddedFrom");
    const dateAddedTo = searchParams.get("dateAddedTo");
    const lastVisitFrom = searchParams.get("lastVisitFrom");
    const lastVisitTo = searchParams.get("lastVisitTo");
    const hasAllergies = searchParams.get("hasAllergies");

    console.log("[Clients API] GET with params:", {
      salonId,
      dateAddedFrom,
      dateAddedTo,
      lastVisitFrom,
      lastVisitTo,
      hasAllergies,
    });

    // Subquery: compute the most recent appointment start_time per client
    const lastVisitSubquery = db
      .select({
        clientId: appointments.clientId,
        lastVisit: sql<string>`MAX(${appointments.startTime})`.as("last_visit"),
      })
      .from(appointments)
      .groupBy(appointments.clientId)
      .as("last_visit_sq");

    // Build the base query: select all client fields plus the computed lastVisit
    let query = db
      .select({
        client: clients,
        lastVisit: lastVisitSubquery.lastVisit,
      })
      .from(clients)
      .leftJoin(lastVisitSubquery, eq(clients.id, lastVisitSubquery.clientId));

    // Accumulate WHERE conditions dynamically
    const conditions = [];

    if (salonId) {
      conditions.push(eq(clients.salonId, salonId));
    }

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

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = await query;
    console.log(`[Clients API] Query returned ${result.length} rows`);

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
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}

// POST /api/clients - Create a new client
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(createClientSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, firstName, lastName, phone, email, notes, preferences, allergies, favoriteEmployeeId, requireDeposit, depositType, depositValue } = body;

    console.log(`[Clients API] Executing: INSERT INTO clients (salon_id, first_name, last_name, phone, email, notes, preferences, allergies, favorite_employee_id)`);
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId,
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        preferences: preferences || null,
        allergies: allergies || null,
        favoriteEmployeeId: favoriteEmployeeId || null,
        requireDeposit: requireDeposit || false,
        depositType: depositType || "percentage",
        depositValue: depositValue || null,
      })
      .returning();

    console.log(`[Clients API] INSERT successful, created client with id: ${newClient?.id}`);

    return NextResponse.json({
      success: true,
      data: newClient,
    }, { status: 201 });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create client" },
      { status: 500 }
    );
  }
}

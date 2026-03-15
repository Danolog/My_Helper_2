import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  waitingList,
  clients,
  services,
  employees,
  salons,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { validateBody, updateWaitingListSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/waiting-list/[id] - Get a single waiting list entry
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id } = await params;

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    const result = await db
      .select({
        entry: waitingList,
        client: clients,
        service: services,
        employee: employees,
      })
      .from(waitingList)
      .innerJoin(clients, eq(waitingList.clientId, clients.id))
      .leftJoin(services, eq(waitingList.serviceId, services.id))
      .leftJoin(
        employees,
        eq(waitingList.preferredEmployeeId, employees.id)
      )
      .where(
        and(eq(waitingList.id, id), eq(waitingList.salonId, salon.id))
      )
      .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    const formattedEntry = {
      id: row.entry.id,
      salonId: row.entry.salonId,
      clientId: row.entry.clientId,
      clientName: `${row.client.firstName} ${row.client.lastName}`,
      clientPhone: row.client.phone || null,
      clientEmail: row.client.email || null,
      serviceId: row.entry.serviceId,
      serviceName: row.service?.name || null,
      preferredEmployeeId: row.entry.preferredEmployeeId,
      preferredEmployeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : null,
      preferredDate: row.entry.preferredDate,
      notifiedAt: row.entry.notifiedAt,
      accepted: row.entry.accepted,
      createdAt: row.entry.createdAt,
    };

    return NextResponse.json({
      success: true,
      data: formattedEntry,
    });
  } catch (error) {
    console.error("[WaitingList API] GET [id] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac wpisu" },
      { status: 500 }
    );
  }
}

// PUT /api/waiting-list/[id] - Update a waiting list entry (accept/decline or modify)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id } = await params;

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Verify the entry belongs to this salon
    const [existing] = await db
      .select()
      .from(waitingList)
      .where(
        and(eq(waitingList.id, id), eq(waitingList.salonId, salon.id))
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updateWaitingListSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { accepted, serviceId, preferredEmployeeId, preferredDate } = body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (accepted !== undefined) {
      updateData.accepted = accepted;
    }

    if (serviceId !== undefined) {
      updateData.serviceId = serviceId || null;
    }

    if (preferredEmployeeId !== undefined) {
      updateData.preferredEmployeeId = preferredEmployeeId || null;
    }

    if (preferredDate !== undefined) {
      updateData.preferredDate = preferredDate
        ? new Date(preferredDate)
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: "Brak danych do aktualizacji" },
        { status: 400 }
      );
    }

    const [updatedEntry] = await db
      .update(waitingList)
      .set(updateData)
      .where(eq(waitingList.id, id))
      .returning();

    console.log(
      `[WaitingList API] PUT: Updated entry ${id} in salon ${salon.id}`,
      updateData
    );

    return NextResponse.json({
      success: true,
      data: updatedEntry,
      message: "Wpis zostal zaktualizowany",
    });
  } catch (error) {
    console.error("[WaitingList API] PUT Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaktualizowac wpisu" },
      { status: 500 }
    );
  }
}

// DELETE /api/waiting-list/[id] - Remove an entry from the waiting list
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id } = await params;

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Verify and delete the entry (must belong to this salon)
    const [deletedEntry] = await db
      .delete(waitingList)
      .where(
        and(eq(waitingList.id, id), eq(waitingList.salonId, salon.id))
      )
      .returning();

    if (!deletedEntry) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    console.log(
      `[WaitingList API] DELETE: Removed entry ${id} from salon ${salon.id}`
    );

    return NextResponse.json({
      success: true,
      data: deletedEntry,
      message: "Wpis zostal usuniety z listy oczekujacych",
    });
  } catch (error) {
    console.error("[WaitingList API] DELETE Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie usunac wpisu" },
      { status: 500 }
    );
  }
}

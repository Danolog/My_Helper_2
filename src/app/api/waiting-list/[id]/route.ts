import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { validateBody, updateWaitingListSchema } from "@/lib/api-validation";
import { auth } from "@/lib/auth";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalon } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import {
  waitingList,
  clients,
  services,
  employees,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
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

    const { id } = await params;

    // Find the salon owned by the current user
    const salon = await getUserSalon();

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    const result = await forSalon(salon.id).raw((tx) =>
      tx
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
        .limit(1)
    );

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
    logger.error("[WaitingList API] GET [id] Error", { error: error });
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

    const { id } = await params;

    // Find the salon owned by the current user
    const salon = await getUserSalon();

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Verify the entry belongs to this salon
    const existing = await forSalon(salon.id).findOne(waitingList, id);

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

    const updatedEntry = await forSalon(salon.id).updateOwned(
      waitingList,
      id,
      updateData as Partial<typeof waitingList.$inferInsert>
    );

    logger.info(`[WaitingList API] PUT: Updated entry ${id} in salon ${salon.id}`,
      updateData);

    return NextResponse.json({
      success: true,
      data: updatedEntry,
      message: "Wpis zostal zaktualizowany",
    });
  } catch (error) {
    logger.error("[WaitingList API] PUT Error", { error: error });
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

    const { id } = await params;

    // Find the salon owned by the current user
    const salon = await getUserSalon();

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Verify and delete the entry (must belong to this salon)
    const deletedEntry = await forSalon(salon.id).deleteOwned(waitingList, id);

    if (!deletedEntry) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    logger.info(`[WaitingList API] DELETE: Removed entry ${id} from salon ${salon.id}`);

    return NextResponse.json({
      success: true,
      data: deletedEntry,
      message: "Wpis zostal usuniety z listy oczekujacych",
    });
  } catch (error) {
    logger.error("[WaitingList API] DELETE Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie usunac wpisu" },
      { status: 500 }
    );
  }
}

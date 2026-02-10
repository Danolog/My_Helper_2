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
import { eq, and, desc, isNull, isNotNull } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/waiting-list - List waiting list entries for the salon owner's salon
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

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

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get("serviceId");
    const statusFilter = searchParams.get("status");

    // Build filter conditions
    const conditions = [eq(waitingList.salonId, salon.id)];

    if (serviceId) {
      conditions.push(eq(waitingList.serviceId, serviceId));
    }

    // Filter by logical status derived from notifiedAt and accepted fields:
    //   pending  = notifiedAt IS NULL, accepted IS NULL
    //   notified = notifiedAt IS NOT NULL, accepted IS NULL
    //   accepted = accepted = true
    //   declined = accepted = false
    if (statusFilter === "pending") {
      conditions.push(isNull(waitingList.notifiedAt));
      conditions.push(isNull(waitingList.accepted));
    } else if (statusFilter === "notified") {
      conditions.push(isNotNull(waitingList.notifiedAt));
      conditions.push(isNull(waitingList.accepted));
    } else if (statusFilter === "accepted") {
      conditions.push(eq(waitingList.accepted, true));
    } else if (statusFilter === "declined") {
      conditions.push(eq(waitingList.accepted, false));
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
      .where(and(...conditions))
      .orderBy(desc(waitingList.createdAt));

    const formattedEntries = result.map((row) => ({
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
    }));

    console.log(
      `[WaitingList API] GET: ${formattedEntries.length} entries for salon ${salon.id}`
    );

    return NextResponse.json({
      success: true,
      data: formattedEntries,
      count: formattedEntries.length,
    });
  } catch (error) {
    console.error("[WaitingList API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac listy oczekujacych" },
      { status: 500 }
    );
  }
}

// POST /api/waiting-list - Add a client to the waiting list (staff action)
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

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

    const body = await request.json();
    const { clientId, serviceId, preferredEmployeeId, preferredDate } = body;

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "clientId jest wymagane" },
        { status: 400 }
      );
    }

    // Verify the client belongs to this salon
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.salonId, salon.id)))
      .limit(1);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Klient nie zostal znaleziony w tym salonie" },
        { status: 404 }
      );
    }

    // Validate serviceId if provided
    if (serviceId) {
      const [service] = await db
        .select()
        .from(services)
        .where(
          and(eq(services.id, serviceId), eq(services.salonId, salon.id))
        )
        .limit(1);

      if (!service) {
        return NextResponse.json(
          {
            success: false,
            error: "Usluga nie zostala znaleziona w tym salonie",
          },
          { status: 404 }
        );
      }
    }

    // Validate preferredEmployeeId if provided
    if (preferredEmployeeId) {
      const [employee] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.id, preferredEmployeeId),
            eq(employees.salonId, salon.id)
          )
        )
        .limit(1);

      if (!employee) {
        return NextResponse.json(
          {
            success: false,
            error: "Pracownik nie zostal znaleziony w tym salonie",
          },
          { status: 404 }
        );
      }
    }

    const [newEntry] = await db
      .insert(waitingList)
      .values({
        salonId: salon.id,
        clientId,
        serviceId: serviceId || null,
        preferredEmployeeId: preferredEmployeeId || null,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
      })
      .returning();

    console.log(
      `[WaitingList API] POST: Created entry ${newEntry?.id} for client ${clientId} in salon ${salon.id}`
    );

    return NextResponse.json(
      {
        success: true,
        data: newEntry,
        message: "Klient zostal dodany do listy oczekujacych",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[WaitingList API] POST Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Nie udalo sie dodac klienta do listy oczekujacych",
      },
      { status: 500 }
    );
  }
}

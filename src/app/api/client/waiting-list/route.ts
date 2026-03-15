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
import { eq, and, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { validateBody, clientWaitingListSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/client/waiting-list - List waiting list entries for the authenticated client
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;

    // Find all client records linked to this user's email across all salons
    const clientRecords = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.email, userEmail));

    if (clientRecords.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
      });
    }

    const clientIds = clientRecords.map((c) => c.id);

    // Fetch waiting list entries for all client records linked to this user
    const allEntries = [];

    for (const clientId of clientIds) {
      const result = await db
        .select({
          entry: waitingList,
          client: clients,
          service: services,
          employee: employees,
          salon: salons,
        })
        .from(waitingList)
        .innerJoin(clients, eq(waitingList.clientId, clients.id))
        .leftJoin(services, eq(waitingList.serviceId, services.id))
        .leftJoin(
          employees,
          eq(waitingList.preferredEmployeeId, employees.id)
        )
        .leftJoin(salons, eq(waitingList.salonId, salons.id))
        .where(eq(waitingList.clientId, clientId))
        .orderBy(desc(waitingList.createdAt));

      allEntries.push(...result);
    }

    allEntries.sort((a, b) => {
      const dateA = new Date(a.entry.createdAt).getTime();
      const dateB = new Date(b.entry.createdAt).getTime();
      return dateB - dateA;
    });

    // Build a map of offered employee names for entries that have offeredEmployeeId
    const offeredEmployeeIds = allEntries
      .map((r) => r.entry.offeredEmployeeId)
      .filter((eid): eid is string => eid !== null);
    const offeredEmployeeNames: Record<string, string> = {};
    if (offeredEmployeeIds.length > 0) {
      for (const eid of [...new Set(offeredEmployeeIds)]) {
        const [emp] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, eid))
          .limit(1);
        if (emp) {
          offeredEmployeeNames[eid] = `${emp.firstName} ${emp.lastName}`;
        }
      }
    }

    const formattedEntries = allEntries.map((row) => ({
      id: row.entry.id,
      salonId: row.entry.salonId,
      salonName: row.salon?.name || "Nieznany salon",
      serviceId: row.entry.serviceId,
      serviceName: row.service?.name || null,
      preferredEmployeeId: row.entry.preferredEmployeeId,
      preferredEmployeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : null,
      preferredDate: row.entry.preferredDate,
      notifiedAt: row.entry.notifiedAt,
      accepted: row.entry.accepted,
      offeredStartTime: row.entry.offeredStartTime,
      offeredEndTime: row.entry.offeredEndTime,
      offeredEmployeeId: row.entry.offeredEmployeeId,
      offeredEmployeeName: row.entry.offeredEmployeeId
        ? offeredEmployeeNames[row.entry.offeredEmployeeId] || null
        : null,
      existingAppointmentId: row.entry.existingAppointmentId,
      createdAt: row.entry.createdAt,
    }));

    logger.info(`[Client WaitingList API] GET: ${formattedEntries.length} entries for user ${session.user.id}`);

    return NextResponse.json({
      success: true,
      data: formattedEntries,
      count: formattedEntries.length,
    });
  } catch (error) {
    logger.error("[Client WaitingList API] GET Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac listy oczekujacych" },
      { status: 500 }
    );
  }
}

// POST /api/client/waiting-list - Client joins a waiting list for a service at a salon
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;
    const body = await request.json();
    const validationError = validateBody(clientWaitingListSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { salonId, serviceId, preferredEmployeeId, preferredDate } = body;

    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon nie zostal znaleziony" },
        { status: 404 }
      );
    }

    let [clientRecord] = await db
      .select()
      .from(clients)
      .where(
        and(eq(clients.email, userEmail), eq(clients.salonId, salonId))
      )
      .limit(1);

    if (!clientRecord) {
      const userName = session.user.name || "";
      const nameParts = userName.split(" ");
      const firstName = nameParts[0] || "Klient";
      const lastName = nameParts.slice(1).join(" ") || "";

      const [newClient] = await db
        .insert(clients)
        .values({
          salonId,
          firstName,
          lastName,
          email: userEmail,
          phone: session.user.phone || null,
        })
        .returning();

      if (!newClient) {
        return NextResponse.json(
          { success: false, error: "Nie udalo sie utworzyc profilu klienta" },
          { status: 500 }
        );
      }

      clientRecord = newClient;
      logger.info(`[Client WaitingList API] Auto-created client ${clientRecord.id} for user ${session.user.id} at salon ${salonId}`);
    }

    if (serviceId) {
      const [service] = await db
        .select()
        .from(services)
        .where(
          and(eq(services.id, serviceId), eq(services.salonId, salonId))
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

    if (preferredEmployeeId) {
      const [employee] = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.id, preferredEmployeeId),
            eq(employees.salonId, salonId)
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
        salonId,
        clientId: clientRecord.id,
        serviceId: serviceId || null,
        preferredEmployeeId: preferredEmployeeId || null,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
      })
      .returning();

    logger.info(`[Client WaitingList API] POST: User ${session.user.id} joined waiting list at salon ${salonId}, entry ${newEntry?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newEntry,
        message: "Zostales dodany do listy oczekujacych",
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("[Client WaitingList API] POST Error", { error: error });
    return NextResponse.json(
      {
        success: false,
        error: "Nie udalo sie dodac do listy oczekujacych",
      },
      { status: 500 }
    );
  }
}

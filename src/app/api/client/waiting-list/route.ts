import { NextResponse } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { validateBody, clientWaitingListSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { verifiedClientMatchEmail } from "@/lib/client-match";
// ADR-001: ścieżka user-scoped (nie salon-scoped) — świadomie surowe db
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  waitingList,
  clients,
  services,
  employees,
  salons,
} from "@/lib/schema";
// GET /api/client/waiting-list - List waiting list entries for the authenticated client
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Dopasowanie do rekordow klienta tylko po ZWERYFIKOWANYM e-mailu
    // (src/lib/client-match.ts). Niezweryfikowany = brak wpisow, nie blad.
    const userEmail = verifiedClientMatchEmail(authResult.user);
    if (!userEmail) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

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
    // in one query (previously one query per client record — N+1)
    const allEntries = await db
      .select({
        // Bez wiersza klienta (imie, telefon, notatki) — portal go nie uzywa.
        entry: waitingList,
        service: { name: services.name },
        employee: { firstName: employees.firstName, lastName: employees.lastName },
        salon: { name: salons.name },
      })
      .from(waitingList)
      .innerJoin(clients, eq(waitingList.clientId, clients.id))
      .leftJoin(services, eq(waitingList.serviceId, services.id))
      .leftJoin(
        employees,
        eq(waitingList.preferredEmployeeId, employees.id)
      )
      .leftJoin(salons, eq(waitingList.salonId, salons.id))
      .where(inArray(waitingList.clientId, clientIds))
      .orderBy(desc(waitingList.createdAt));

    // Build a map of offered employee names for entries that have offeredEmployeeId
    const offeredEmployeeIds = allEntries
      .map((r) => r.entry.offeredEmployeeId)
      .filter((eid): eid is string => eid !== null);
    const offeredEmployeeNames: Record<string, string> = {};
    if (offeredEmployeeIds.length > 0) {
      // One query for all offered employees (previously one per employee)
      const offeredEmployees = await db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(employees)
        .where(inArray(employees.id, [...new Set(offeredEmployeeIds)]));
      for (const emp of offeredEmployees) {
        offeredEmployeeNames[emp.id] = `${emp.firstName} ${emp.lastName}`;
      }
    }

    // Tylko pola renderowane przez portal (src/app/(client)/waiting-list/page.tsx)
    const formattedEntries = allEntries.map((row) => ({
      id: row.entry.id,
      salonName: row.salon?.name || "Nieznany salon",
      serviceName: row.service?.name || null,
      preferredEmployeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : null,
      notifiedAt: row.entry.notifiedAt,
      accepted: row.entry.accepted,
      offeredStartTime: row.entry.offeredStartTime,
      offeredEndTime: row.entry.offeredEndTime,
      offeredEmployeeName: row.entry.offeredEmployeeId
        ? offeredEmployeeNames[row.entry.offeredEmployeeId] || null
        : null,
      existingAppointmentId: row.entry.existingAppointmentId,
      createdAt: row.entry.createdAt,
    }));

    logger.info(`[Client WaitingList API] GET: ${formattedEntries.length} entries for user ${authResult.user.id}`);

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
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Zapis na liste podpina konto pod rekord klienta po e-mailu albo tworzy
    // rekord z tym e-mailem — oba tylko dla zweryfikowanego e-maila.
    const userEmail = verifiedClientMatchEmail(authResult.user);
    if (!userEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "Potwierdz adres e-mail, aby dolaczyc do listy oczekujacych",
        },
        { status: 403 }
      );
    }
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
      const userName = authResult.user.name || "";
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
          phone: (authResult.user as unknown as Record<string, string | null>).phone || null,
        })
        .returning();

      if (!newClient) {
        return NextResponse.json(
          { success: false, error: "Nie udalo sie utworzyc profilu klienta" },
          { status: 500 }
        );
      }

      clientRecord = newClient;
      logger.info(`[Client WaitingList API] Auto-created client ${clientRecord.id} for user ${authResult.user.id} at salon ${salonId}`);
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

    logger.info(`[Client WaitingList API] POST: User ${authResult.user.id} joined waiting list at salon ${salonId}, entry ${newEntry?.id}`);

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

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, employees, services } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

// GET /api/clients/[id]/appointments - Get all appointments for a specific client
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // First verify client exists
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    console.log(`[Client Appointments API] Fetching appointments for client: ${client.firstName} ${client.lastName} (${id})`);

    // Fetch all appointments for this client with joined employee and service data
    const result = await db
      .select({
        appointment: appointments,
        employee: employees,
        service: services,
      })
      .from(appointments)
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(eq(appointments.clientId, id))
      .orderBy(desc(appointments.startTime));

    const formattedAppointments = result.map((row) => ({
      ...row.appointment,
      employee: row.employee
        ? {
            id: row.employee.id,
            firstName: row.employee.firstName,
            lastName: row.employee.lastName,
            color: row.employee.color,
          }
        : null,
      service: row.service
        ? {
            id: row.service.id,
            name: row.service.name,
            basePrice: row.service.basePrice,
            baseDuration: row.service.baseDuration,
          }
        : null,
    }));

    console.log(`[Client Appointments API] Found ${formattedAppointments.length} appointments for client ${id}`);

    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      count: formattedAppointments.length,
    });
  } catch (error) {
    console.error("[Client Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch client appointments" },
      { status: 500 }
    );
  }
}

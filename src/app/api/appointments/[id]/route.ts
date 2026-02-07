import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, employees, services } from "@/lib/schema";
import { eq, and, not, or, lte, gte } from "drizzle-orm";

// GET /api/appointments/[id] - Get a single appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await db.select({
      appointment: appointments,
      client: clients,
      employee: employees,
      service: services,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(eq(appointments.id, id))
    .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    const formattedAppointment = {
      ...row.appointment,
      client: row.client,
      employee: row.employee,
      service: row.service,
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
    });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment" },
      { status: 500 }
    );
  }
}

// PUT /api/appointments/[id] - Update an appointment (reschedule)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { startTime, endTime, employeeId, clientId, serviceId, notes, status } = body;

    // Check if appointment exists
    const [existing] = await db.select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // If times or employee changed, check for conflicts
    const newStartTime = startTime ? new Date(startTime) : existing.startTime;
    const newEndTime = endTime ? new Date(endTime) : existing.endTime;
    const newEmployeeId = employeeId || existing.employeeId;

    // Check for overlapping appointments (excluding current one)
    const overlapping = await db.select()
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, newEmployeeId),
          not(eq(appointments.id, id)),
          not(eq(appointments.status, "cancelled")),
          or(
            and(
              lte(appointments.startTime, newStartTime),
              gte(appointments.endTime, newStartTime)
            ),
            and(
              lte(appointments.startTime, newEndTime),
              gte(appointments.endTime, newEndTime)
            ),
            and(
              gte(appointments.startTime, newStartTime),
              lte(appointments.endTime, newEndTime)
            )
          )
        )
      );

    if (overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: "Time slot conflicts with existing appointment", conflictingAppointment: overlapping[0] },
        { status: 409 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (startTime) updateData.startTime = newStartTime;
    if (endTime) updateData.endTime = newEndTime;
    if (employeeId) updateData.employeeId = employeeId;
    if (clientId !== undefined) updateData.clientId = clientId;
    if (serviceId !== undefined) updateData.serviceId = serviceId;
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;

    console.log(`[Appointments API] Updating appointment ${id}:`, updateData);

    const [updatedAppointment] = await db
      .update(appointments)
      .set(updateData)
      .where(eq(appointments.id, id))
      .returning();

    console.log(`[Appointments API] Updated appointment ${id} successfully`);

    return NextResponse.json({
      success: true,
      data: updatedAppointment,
      message: "Appointment rescheduled successfully",
    });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update appointment" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointments/[id] - Cancel an appointment
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Soft delete by setting status to cancelled
    const [cancelledAppointment] = await db
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.id, id))
      .returning();

    if (!cancelledAppointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    console.log(`[Appointments API] Cancelled appointment ${id}`);

    return NextResponse.json({
      success: true,
      data: cancelledAppointment,
      message: "Appointment cancelled successfully",
    });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to cancel appointment" },
      { status: 500 }
    );
  }
}

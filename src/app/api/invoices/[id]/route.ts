import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, clients, appointments, employees, services } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/invoices/[id]
 *
 * Fetch a single invoice by ID, including related client, appointment,
 * employee, and service data. Scoped to the salon for security.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        amount: invoices.amount,
        vatRate: invoices.vatRate,
        vatAmount: invoices.vatAmount,
        netAmount: invoices.netAmount,
        clientName: invoices.clientName,
        clientAddress: invoices.clientAddress,
        companyName: invoices.companyName,
        companyNip: invoices.companyNip,
        description: invoices.description,
        paymentMethod: invoices.paymentMethod,
        invoiceDataJson: invoices.invoiceDataJson,
        issuedAt: invoices.issuedAt,
        createdAt: invoices.createdAt,
        emailSentAt: invoices.emailSentAt,
        emailSentTo: invoices.emailSentTo,
        appointmentId: invoices.appointmentId,
        clientId: invoices.clientId,
        // Joined fields
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientEmail: clients.email,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
        appointmentStartTime: appointments.startTime,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(appointments, eq(invoices.appointmentId, appointments.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(eq(invoices.id, id), eq(invoices.salonId, DEMO_SALON_ID)))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Faktura nie zostala znaleziona" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("[Invoice API] GET by ID Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac faktury" },
      { status: 500 }
    );
  }
}

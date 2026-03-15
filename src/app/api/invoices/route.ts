import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, clients, appointments, employees, services, salons } from "@/lib/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * GET /api/invoices
 *
 * List all invoices for the salon with optional filters.
 *
 * Query params:
 *  - dateFrom: ISO date string (filter issued_at >= dateFrom)
 *  - dateTo: ISO date string (filter issued_at <= dateTo)
 *  - type: 'paragon' | 'faktura' (filter by invoice type)
 *  - search: string (search by invoice number, client name, or company name)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Resolve salon from authenticated user
    const [salon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(eq(salons.ownerId, authResult.user.id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    const salonId = salon.id;

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const type = searchParams.get("type");
    const search = searchParams.get("search");

    // Build conditions
    const conditions = [eq(invoices.salonId, salonId)];

    if (dateFrom) {
      conditions.push(gte(invoices.issuedAt, new Date(dateFrom)));
    }
    if (dateTo) {
      // Include entire day
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(invoices.issuedAt, endDate));
    }
    if (type && ["paragon", "faktura"].includes(type)) {
      conditions.push(eq(invoices.type, type));
    }
    if (search) {
      // Escape LIKE wildcard characters to prevent injection of search patterns
      const sanitized = search.replace(/[%_]/g, "\\$&");
      const searchLower = `%${sanitized.toLowerCase()}%`;
      conditions.push(
        sql`(
          LOWER(${invoices.invoiceNumber}) LIKE ${searchLower} OR
          LOWER(${invoices.clientName}) LIKE ${searchLower} OR
          LOWER(${invoices.companyName}) LIKE ${searchLower}
        )`
      );
    }

    // Query invoices with related data
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
        appointmentId: invoices.appointmentId,
        clientId: invoices.clientId,
        // Joined fields
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
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
      .where(and(...conditions))
      .orderBy(desc(invoices.issuedAt));

    // Calculate summary
    const totalAmount = rows.reduce(
      (sum, r) => sum + parseFloat(r.amount),
      0
    );
    const totalVat = rows.reduce(
      (sum, r) => sum + parseFloat(r.vatAmount || "0"),
      0
    );
    const totalNet = rows.reduce(
      (sum, r) => sum + parseFloat(r.netAmount || "0"),
      0
    );
    const paragonCount = rows.filter((r) => r.type === "paragon").length;
    const fakturaCount = rows.filter((r) => r.type === "faktura").length;

    return NextResponse.json({
      success: true,
      data: rows,
      summary: {
        totalInvoices: rows.length,
        totalAmount: totalAmount.toFixed(2),
        totalVat: totalVat.toFixed(2),
        totalNet: totalNet.toFixed(2),
        paragonCount,
        fakturaCount,
      },
    });
  } catch (error) {
    console.error("[Invoices API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac faktur" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";
import { invoices, clients, appointments, employees, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
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
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Invoices API] GET",
    errorMessage: "Nie udalo sie pobrac faktur",
  },
  async ({ request }) => {
    // Resolve salon from authenticated user (auth: "user" gwarantuje sesje).
    // Faza 3 (role): faktury tylko owner, chyba że czasowy grant "invoices".
    const ctx = await getSalonContext();

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }
    if (ctx.role !== "owner" && !(await hasFeatureAccess(ctx, "invoices"))) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }

    const salonId = ctx.salonId;

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
    const rows = await forSalon(salonId).raw((tx) =>
      tx
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
      .orderBy(desc(invoices.issuedAt))
    );

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
  }
);

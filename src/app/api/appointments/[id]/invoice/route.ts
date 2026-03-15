import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  salons,
  appointmentMaterials,
  products,
  invoices,
} from "@/lib/schema";
import { eq, and, count } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { DEFAULT_VAT_RATE } from "@/lib/constants";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * GET /api/appointments/[id]/invoice
 *
 * Check if an invoice exists for this appointment and return it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userSalonId = await getUserSalonId();
    if (!userSalonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    const existingInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.appointmentId, id))
      .limit(1);

    if (existingInvoices.length === 0) {
      return NextResponse.json({
        success: true,
        data: null,
        hasInvoice: false,
      });
    }

    return NextResponse.json({
      success: true,
      data: existingInvoices[0],
      hasInvoice: true,
    });
  } catch (error) {
    console.error("[Invoice API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac faktury" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/appointments/[id]/invoice
 *
 * Generate an invoice for a completed appointment.
 *
 * Body:
 *  - type: 'paragon' | 'faktura' (required)
 *  - clientName: string (required for individual invoices)
 *  - clientAddress: string (optional, for individual invoices)
 *  - companyName: string (required for company invoices)
 *  - companyNip: string (required for company invoices)
 *  - paymentMethod: 'cash' | 'card' | 'transfer' (default: 'cash')
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userSalonId = await getUserSalonId();
    if (!userSalonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      type = "paragon",
      clientName: inputClientName,
      clientAddress,
      companyName,
      companyNip,
      companyAddress,
      paymentMethod = "cash",
    } = body;

    // Validate type
    if (!["paragon", "faktura"].includes(type)) {
      return NextResponse.json(
        { success: false, error: "Typ faktury musi byc 'paragon' lub 'faktura'" },
        { status: 400 }
      );
    }

    // Validate required fields for individual invoice
    if (type === "paragon" && !inputClientName) {
      return NextResponse.json(
        { success: false, error: "Imie i nazwisko klienta jest wymagane" },
        { status: 400 }
      );
    }

    // Validate required fields for company invoice
    if (type === "faktura") {
      if (!companyName) {
        return NextResponse.json(
          { success: false, error: "Nazwa firmy jest wymagana" },
          { status: 400 }
        );
      }
      if (!companyNip) {
        return NextResponse.json(
          { success: false, error: "NIP firmy jest wymagany" },
          { status: 400 }
        );
      }
    }

    // 1. Fetch appointment
    const [appointment] = await db
      .select({
        id: appointments.id,
        salonId: appointments.salonId,
        status: appointments.status,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        clientId: appointments.clientId,
        employeeId: appointments.employeeId,
        serviceId: appointments.serviceId,
      })
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Wizyta nie zostala znaleziona" },
        { status: 404 }
      );
    }

    if (appointment.status !== "completed") {
      return NextResponse.json(
        {
          success: false,
          error: "Fakture mozna wystawic tylko dla zakonczonych wizyt",
        },
        { status: 400 }
      );
    }

    // 2. Check if invoice already exists
    const existingInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.appointmentId, id))
      .limit(1);

    if (existingInvoices.length > 0) {
      return NextResponse.json({
        success: true,
        data: existingInvoices[0],
        message: "Faktura juz istnieje dla tej wizyty",
        alreadyExists: true,
      });
    }

    // 3. Fetch related data
    let clientFullName: string | null = null;
    if (appointment.clientId) {
      const [client] = await db
        .select({ firstName: clients.firstName, lastName: clients.lastName })
        .from(clients)
        .where(eq(clients.id, appointment.clientId))
        .limit(1);
      if (client) {
        clientFullName = `${client.firstName} ${client.lastName}`;
      }
    }

    let employeeName: string | null = null;
    if (appointment.employeeId) {
      const [employee] = await db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(employees)
        .where(eq(employees.id, appointment.employeeId))
        .limit(1);
      if (employee) {
        employeeName = `${employee.firstName} ${employee.lastName}`;
      }
    }

    let serviceName: string | null = null;
    let servicePrice = "0";
    if (appointment.serviceId) {
      const [service] = await db
        .select({ name: services.name, basePrice: services.basePrice })
        .from(services)
        .where(eq(services.id, appointment.serviceId))
        .limit(1);
      if (service) {
        serviceName = service.name;
        servicePrice = service.basePrice;
      }
    }

    // 4. Calculate materials cost
    const materialsRows = await db
      .select({
        quantityUsed: appointmentMaterials.quantityUsed,
        pricePerUnit: products.pricePerUnit,
        productName: products.name,
      })
      .from(appointmentMaterials)
      .leftJoin(products, eq(appointmentMaterials.productId, products.id))
      .where(eq(appointmentMaterials.appointmentId, id));

    const materialsCost = materialsRows.reduce((sum, m) => {
      if (m.pricePerUnit) {
        return sum + parseFloat(m.quantityUsed) * parseFloat(m.pricePerUnit);
      }
      return sum;
    }, 0);

    // 5. Get salon info
    const salonId = appointment.salonId || userSalonId;
    const [salon] = await db
      .select({
        name: salons.name,
        address: salons.address,
        settingsJson: salons.settingsJson,
      })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const salonSettings = (salon?.settingsJson as Record<string, unknown>) || {};
    const fiscalSettings = (salonSettings.fiscal || {}) as Record<string, unknown>;
    const salonNip = (fiscalSettings.nip as string) || "";

    // 6. Calculate totals with VAT
    const totalAmount = parseFloat(servicePrice) + materialsCost;
    const vatRate = DEFAULT_VAT_RATE;
    const netAmount = totalAmount / (1 + vatRate / 100);
    const vatAmount = totalAmount - netAmount;

    // 7. Generate invoice number
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    // Count existing invoices for this salon
    const [invoiceCount] = await db
      .select({ count: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.salonId, salonId),
        )
      );

    const seqNum = ((invoiceCount?.count as number) || 0) + 1;
    const invoiceNumber =
      type === "paragon"
        ? `PAR/${year}/${month}/${String(seqNum).padStart(5, "0")}`
        : `FV/${year}/${month}/${String(seqNum).padStart(5, "0")}`;

    // 8. Build invoice data
    const invoiceClientName =
      type === "paragon" ? (inputClientName || clientFullName || "Klient") : null;

    const paymentMethodLabel =
      paymentMethod === "cash"
        ? "Gotowka"
        : paymentMethod === "card"
          ? "Karta"
          : "Przelew";

    const invoiceData = {
      seller: {
        name: salon?.name || "Salon",
        address: salon?.address || "",
        nip: salonNip || null,
      },
      buyer: {
        name:
          type === "paragon"
            ? invoiceClientName
            : companyName,
        address: type === "paragon" ? (clientAddress || null) : (companyAddress || null),
        nip: type === "faktura" ? companyNip : null,
      },
      invoiceNumber,
      issueDate: now.toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      items: [
        ...(serviceName
          ? [
              {
                name: serviceName,
                quantity: 1,
                unitPrice: parseFloat(servicePrice).toFixed(2),
                netPrice: (parseFloat(servicePrice) / (1 + vatRate / 100)).toFixed(2),
                total: parseFloat(servicePrice).toFixed(2),
                vatRate: `${vatRate}%`,
              },
            ]
          : []),
        ...(materialsCost > 0
          ? [
              {
                name: "Materialy uzyte podczas zabiegu",
                quantity: 1,
                unitPrice: materialsCost.toFixed(2),
                netPrice: (materialsCost / (1 + vatRate / 100)).toFixed(2),
                total: materialsCost.toFixed(2),
                vatRate: `${vatRate}%`,
              },
            ]
          : []),
      ],
      summary: {
        netAmount: netAmount.toFixed(2),
        vatRate: `${vatRate}%`,
        vatAmount: vatAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
      },
      paymentMethod: paymentMethodLabel,
      employee: employeeName,
      appointmentDate: new Date(appointment.startTime).toLocaleDateString(
        "pl-PL",
        { day: "2-digit", month: "2-digit", year: "numeric" }
      ),
      appointmentTime: `${new Date(appointment.startTime).toLocaleTimeString(
        "pl-PL",
        { hour: "2-digit", minute: "2-digit" }
      )} - ${new Date(appointment.endTime).toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    };

    // 9. Save invoice to database
    const [newInvoice] = await db
      .insert(invoices)
      .values({
        salonId,
        appointmentId: id,
        clientId: appointment.clientId,
        invoiceNumber,
        type,
        companyName: type === "faktura" ? companyName : null,
        companyNip: type === "faktura" ? companyNip : null,
        clientName: invoiceClientName,
        clientAddress: type === "paragon" ? (clientAddress || null) : null,
        description: serviceName
          ? `Usluga: ${serviceName}`
          : "Usluga kosmetyczna",
        paymentMethod,
        amount: totalAmount.toFixed(2),
        vatRate: vatRate.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        netAmount: netAmount.toFixed(2),
        invoiceDataJson: invoiceData,
      })
      .returning();

    console.log(
      `[Invoice] Generated invoice ${invoiceNumber} for appointment ${id}`
    );

    return NextResponse.json({
      success: true,
      data: newInvoice,
      invoiceData,
      message: `Faktura ${invoiceNumber} zostala wygenerowana`,
    });
  } catch (error) {
    console.error("[Invoice API] POST Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wygenerowac faktury" },
      { status: 500 }
    );
  }
}

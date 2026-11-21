import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { validateBody, invoiceSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { DEFAULT_VAT_RATE } from "@/lib/constants";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
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
import { forSalon } from "@/lib/server/repository";
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

    const existingInvoices = await forSalon(userSalonId).raw((tx) =>
      tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.appointmentId, id), eq(invoices.salonId, userSalonId)))
      .limit(1)
    );

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
    logger.error("[Invoice API] GET Error", { error: error });
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
    const validationError = validateBody(invoiceSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
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
    const [appointment] = await forSalon(userSalonId).raw((tx) =>
      tx
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
      .where(and(eq(appointments.id, id), eq(appointments.salonId, userSalonId)))
      .limit(1)
    );

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

    // 2. Check if invoice already exists (scoped to caller's salon)
    const existingInvoices = await forSalon(userSalonId).raw((tx) =>
      tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.appointmentId, id), eq(invoices.salonId, userSalonId)))
      .limit(1)
    );

    if (existingInvoices.length > 0) {
      return NextResponse.json({
        success: true,
        data: existingInvoices[0],
        message: "Faktura juz istnieje dla tej wizyty",
        alreadyExists: true,
      });
    }

    // 3–5. Odczyty poboczne (klient, pracownik, usługa, materiały, dane
    // sprzedawcy) w kontekście RLS salonu z sesji (#193): `salons` ma politykę
    // `tenant_self`, `appointment_materials` pośrednią przez wizytę. Jawne
    // filtry salonu zostają tam, gdzie tabela ma `salon_id`.
    const salonId = appointment.salonId || userSalonId;
    const related = await forSalon(userSalonId).raw(async (tx) => {
      const clientId = appointment.clientId;
      const client = clientId
        ? (
            await tx
              .select({ firstName: clients.firstName, lastName: clients.lastName })
              .from(clients)
              .where(and(eq(clients.id, clientId), eq(clients.salonId, userSalonId)))
              .limit(1)
          )[0]
        : undefined;

      const employeeId = appointment.employeeId;
      const employee = employeeId
        ? (
            await tx
              .select({
                firstName: employees.firstName,
                lastName: employees.lastName,
              })
              .from(employees)
              .where(and(eq(employees.id, employeeId), eq(employees.salonId, userSalonId)))
              .limit(1)
          )[0]
        : undefined;

      const serviceId = appointment.serviceId;
      const service = serviceId
        ? (
            await tx
              .select({ name: services.name, basePrice: services.basePrice })
              .from(services)
              .where(and(eq(services.id, serviceId), eq(services.salonId, userSalonId)))
              .limit(1)
          )[0]
        : undefined;

      // 4. Materials used during the appointment
      const materialsRows = await tx
        .select({
          quantityUsed: appointmentMaterials.quantityUsed,
          pricePerUnit: products.pricePerUnit,
          productName: products.name,
        })
        .from(appointmentMaterials)
        .leftJoin(products, eq(appointmentMaterials.productId, products.id))
        .where(eq(appointmentMaterials.appointmentId, id));

      // 5. Get salon info
      const [salon] = await tx
        .select({
          name: salons.name,
          address: salons.address,
          settingsJson: salons.settingsJson,
        })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1);

      return { client, employee, service, materialsRows, salon };
    });

    const { client, employee, service, materialsRows, salon } = related;
    const clientFullName: string | null = client
      ? `${client.firstName} ${client.lastName}`
      : null;
    const employeeName: string | null = employee
      ? `${employee.firstName} ${employee.lastName}`
      : null;
    const serviceName: string | null = service ? service.name : null;
    const servicePrice = service ? service.basePrice : "0";

    const materialsCost = materialsRows.reduce((sum, m) => {
      if (m.pricePerUnit) {
        return sum + parseFloat(m.quantityUsed) * parseFloat(m.pricePerUnit);
      }
      return sum;
    }, 0);

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
    const [invoiceCount] = await forSalon(salonId).raw((tx) =>
      tx
      .select({ count: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.salonId, salonId),
        )
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
    const [newInvoice] = await forSalon(salonId).raw((tx) =>
      tx
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
      .returning()
    );

    logger.info(`[Invoice] Generated invoice ${invoiceNumber} for appointment ${id}`);

    return NextResponse.json({
      success: true,
      data: newInvoice,
      invoiceData,
      message: `Faktura ${invoiceNumber} zostala wygenerowana`,
    });
  } catch (error) {
    logger.error("[Invoice API] POST Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wygenerowac faktury" },
      { status: 500 }
    );
  }
}

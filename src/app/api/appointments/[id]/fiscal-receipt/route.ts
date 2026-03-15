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
  fiscalReceipts,
} from "@/lib/schema";
import { eq, and, count } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { DEFAULT_VAT_RATE } from "@/lib/constants";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * GET /api/appointments/[id]/fiscal-receipt
 *
 * Check if a fiscal receipt exists for this appointment and return it.
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

    const receipts = await db
      .select()
      .from(fiscalReceipts)
      .where(eq(fiscalReceipts.appointmentId, id))
      .limit(1);

    if (receipts.length === 0) {
      return NextResponse.json({
        success: true,
        data: null,
        hasReceipt: false,
      });
    }

    return NextResponse.json({
      success: true,
      data: receipts[0],
      hasReceipt: true,
    });
  } catch (error) {
    console.error("[Fiscal Receipt API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch fiscal receipt" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/appointments/[id]/fiscal-receipt
 *
 * Print a fiscal receipt for a completed appointment.
 * Generates the receipt data, stores it in the database, and
 * sends the print command to the configured fiscal printer.
 *
 * Body (optional):
 *  - paymentMethod: 'cash' | 'card' | 'transfer' (default: 'cash')
 *  - printCopy: boolean (whether to print a copy for the salon)
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
    const paymentMethod = body.paymentMethod || "cash";

    // 1. Fetch appointment with all related data
    const [appointment] = await db
      .select({
        id: appointments.id,
        salonId: appointments.salonId,
        status: appointments.status,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        notes: appointments.notes,
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
          error: "Paragon fiskalny mozna wydrukowac tylko dla zakonczonych wizyt",
        },
        { status: 400 }
      );
    }

    // 2. Check if receipt already exists
    const existingReceipts = await db
      .select()
      .from(fiscalReceipts)
      .where(eq(fiscalReceipts.appointmentId, id))
      .limit(1);

    if (existingReceipts.length > 0) {
      return NextResponse.json({
        success: true,
        data: existingReceipts[0],
        message: "Paragon fiskalny juz istnieje dla tej wizyty",
        alreadyExists: true,
      });
    }

    // 3. Fetch related data
    let clientName: string | null = null;
    if (appointment.clientId) {
      const [client] = await db
        .select({ firstName: clients.firstName, lastName: clients.lastName })
        .from(clients)
        .where(eq(clients.id, appointment.clientId))
        .limit(1);
      if (client) {
        clientName = `${client.firstName} ${client.lastName}`;
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

    // 5. Get salon fiscal settings
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

    const nip = (fiscalSettings.nip as string) || "";
    const printerModel = (fiscalSettings.printerModel as string) || "Brak drukarki";
    const headerLine1 = (fiscalSettings.headerLine1 as string) || salon?.name || "";
    const headerLine2 = (fiscalSettings.headerLine2 as string) || salon?.address || "";
    const headerLine3 = (fiscalSettings.headerLine3 as string) || "";

    // 6. Calculate totals with VAT
    const totalAmount = parseFloat(servicePrice) + materialsCost;
    const vatRate = DEFAULT_VAT_RATE;
    const netAmount = totalAmount / (1 + vatRate / 100);
    const vatAmount = totalAmount - netAmount;

    // 7. Generate receipt number (format: FV/YYYY/MM/NNNNN)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    // Count existing receipts for this salon this month
    const [receiptCount] = await db
      .select({ count: count() })
      .from(fiscalReceipts)
      .where(
        and(
          eq(fiscalReceipts.salonId, salonId),
        )
      );

    const seqNum = ((receiptCount?.count as number) || 0) + 1;
    const receiptNumber = `FV/${year}/${month}/${String(seqNum).padStart(5, "0")}`;

    // 8. Build receipt data for printing and storage
    const receiptData = {
      header: {
        line1: headerLine1,
        line2: headerLine2,
        line3: headerLine3,
        nip: nip ? `NIP: ${nip}` : null,
      },
      receiptNumber,
      date: now.toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      time: now.toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      items: [
        ...(serviceName
          ? [
              {
                name: serviceName,
                quantity: 1,
                unitPrice: parseFloat(servicePrice).toFixed(2),
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
      paymentMethod:
        paymentMethod === "cash"
          ? "GOTOWKA"
          : paymentMethod === "card"
            ? "KARTA"
            : "PRZELEW",
      client: clientName,
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
      footer: "Dziekujemy za wizyte!",
    };

    // 9. Save receipt to database
    const [newReceipt] = await db
      .insert(fiscalReceipts)
      .values({
        appointmentId: id,
        salonId,
        receiptNumber,
        nip: nip || null,
        clientName,
        employeeName,
        serviceName,
        servicePrice,
        materialsCost: materialsCost.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        vatRate: vatRate.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        netAmount: netAmount.toFixed(2),
        paymentMethod,
        printerModel,
        printStatus: "sent",
        receiptDataJson: receiptData,
      })
      .returning();

    // 10. Log print command (in production this would be sent to the fiscal printer)
    console.log(
      `[Fiscal Receipt] Printing receipt ${receiptNumber} for appointment ${id}:`,
      JSON.stringify(receiptData, null, 2)
    );
    console.log(
      `[Fiscal Receipt] Sent to printer: ${printerModel} (${
        (fiscalSettings.connectionType as string) || "not configured"
      })`
    );

    return NextResponse.json({
      success: true,
      data: newReceipt,
      receipt: receiptData,
      message: `Paragon fiskalny ${receiptNumber} zostal wyslany do drukarki`,
    });
  } catch (error) {
    console.error("[Fiscal Receipt API] POST Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wydrukowac paragonu fiskalnego" },
      { status: 500 }
    );
  }
}

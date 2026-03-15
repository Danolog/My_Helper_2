import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, services, employees } from "@/lib/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

const MONTH_NAMES_PL = [
  "Styczen",
  "Luty",
  "Marzec",
  "Kwiecien",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpien",
  "Wrzesien",
  "Pazdziernik",
  "Listopad",
  "Grudzien",
];

/**
 * Parses a "YYYY-MM" string into start and end Date objects for that month.
 * Returns null if the format is invalid.
 */
function parseMonthRange(
  monthStr: string
): { start: Date; end: Date } | null {
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);

  if (month < 1 || month > 12) return null;

  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  // Last moment of the last day of the month
  const end = new Date(year, month, 0, 23, 59, 59, 999);

  return { start, end };
}

/**
 * Generates a Polish label for a given "YYYY-MM" string.
 * Example: "2026-01" -> "Styczen 2026"
 */
function getMonthLabel(monthStr: string): string {
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthStr;

  const year = match[1]!;
  const monthIndex = parseInt(match[2]!, 10) - 1;
  const name = MONTH_NAMES_PL[monthIndex] ?? "Nieznany";

  return `${name} ${year}`;
}

interface MonthMetrics {
  totalRevenue: string;
  totalAppointments: number;
  avgRevenuePerAppointment: string;
  totalCancellations: number;
  cancellationRate: string;
  uniqueClients: number;
  newClients: number;
  topService: { name: string; count: number } | null;
  topEmployee: { name: string; count: number } | null;
}

/**
 * Computes all metrics for a single month within the given salon.
 *
 * The "newClients" metric requires knowing each client's earliest appointment
 * across ALL time, so we accept a pre-computed map of clientId -> earliest date.
 */
async function computeMonthMetrics(
  salonId: string,
  monthStart: Date,
  monthEnd: Date,
  clientFirstAppointmentMap: Map<string, Date>
): Promise<MonthMetrics> {
  // Build conditions for completed appointments in this month
  const completedConditions: ReturnType<typeof eq>[] = [
    eq(appointments.salonId, salonId),
    eq(appointments.status, "completed"),
    gte(appointments.startTime, monthStart),
    lte(appointments.startTime, monthEnd),
  ];

  // Fetch all completed appointments with joined details
  const completedAppts = await db
    .select({
      appointmentId: appointments.id,
      clientId: appointments.clientId,
      serviceId: services.id,
      serviceName: services.name,
      basePrice: services.basePrice,
      employeeId: employees.id,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      discountAmount: appointments.discountAmount,
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .where(and(...completedConditions));

  // Fetch cancelled + no_show appointments in this month
  const cancelledConditions: ReturnType<typeof eq>[] = [
    eq(appointments.salonId, salonId),
    gte(appointments.startTime, monthStart),
    lte(appointments.startTime, monthEnd),
    sql`${appointments.status} IN ('cancelled', 'no_show')`,
  ];

  const cancelledAppts = await db
    .select({
      appointmentId: appointments.id,
    })
    .from(appointments)
    .where(and(...cancelledConditions));

  // Calculate revenue
  let totalRevenue = 0;
  for (const appt of completedAppts) {
    const price = parseFloat(appt.basePrice || "0");
    const discount = parseFloat(appt.discountAmount || "0");
    totalRevenue += Math.max(0, price - discount);
  }

  const totalAppointments = completedAppts.length;
  const totalCancellations = cancelledAppts.length;

  // Average revenue per appointment (guard against division by zero)
  const avgRevenuePerAppointment =
    totalAppointments > 0 ? totalRevenue / totalAppointments : 0;

  // Cancellation rate: cancellations / (completed + cancellations) * 100
  const totalForRate = totalAppointments + totalCancellations;
  const cancellationRate =
    totalForRate > 0 ? (totalCancellations / totalForRate) * 100 : 0;

  // Unique clients from completed appointments
  const clientIdSet = new Set<string>();
  for (const appt of completedAppts) {
    if (appt.clientId) {
      clientIdSet.add(appt.clientId);
    }
  }
  const uniqueClients = clientIdSet.size;

  // New clients: clients whose FIRST EVER appointment falls within this month
  let newClients = 0;
  Array.from(clientIdSet).forEach((clientId) => {
    const firstDate = clientFirstAppointmentMap.get(clientId);
    if (firstDate && firstDate >= monthStart && firstDate <= monthEnd) {
      newClients++;
    }
  });

  // Top service by completed appointment count
  const serviceCountMap: Record<string, { name: string; count: number }> = {};
  for (const appt of completedAppts) {
    const svcId = appt.serviceId || "unknown";
    const svcName = appt.serviceName || "Nieznana usluga";
    if (!serviceCountMap[svcId]) {
      serviceCountMap[svcId] = { name: svcName, count: 0 };
    }
    serviceCountMap[svcId]!.count += 1;
  }

  let topService: { name: string; count: number } | null = null;
  for (const entry of Object.values(serviceCountMap)) {
    if (!topService || entry.count > topService.count) {
      topService = { name: entry.name, count: entry.count };
    }
  }

  // Top employee by completed appointment count
  const employeeCountMap: Record<string, { name: string; count: number }> = {};
  for (const appt of completedAppts) {
    const empId = appt.employeeId || "unknown";
    const empName = appt.employeeFirstName
      ? `${appt.employeeFirstName} ${appt.employeeLastName}`
      : "Nieznany pracownik";
    if (!employeeCountMap[empId]) {
      employeeCountMap[empId] = { name: empName, count: 0 };
    }
    employeeCountMap[empId]!.count += 1;
  }

  let topEmployee: { name: string; count: number } | null = null;
  for (const entry of Object.values(employeeCountMap)) {
    if (!topEmployee || entry.count > topEmployee.count) {
      topEmployee = { name: entry.name, count: entry.count };
    }
  }

  return {
    totalRevenue: totalRevenue.toFixed(2),
    totalAppointments,
    avgRevenuePerAppointment: avgRevenuePerAppointment.toFixed(2),
    totalCancellations,
    cancellationRate: cancellationRate.toFixed(1),
    uniqueClients,
    newClients,
    topService,
    topEmployee,
  };
}

interface ChangeEntry {
  value: string;
  percent: string;
  direction: "up" | "down" | "neutral";
}

/**
 * Computes the delta between two numeric values (month2 - month1)
 * and returns value, percent change, and direction.
 */
function computeChange(val1: number, val2: number, decimals: number = 2): ChangeEntry {
  const diff = val2 - val1;
  const percent = val1 !== 0 ? (diff / val1) * 100 : val2 !== 0 ? 100 : 0;

  let direction: "up" | "down" | "neutral";
  if (diff > 0) {
    direction = "up";
  } else if (diff < 0) {
    direction = "down";
  } else {
    direction = "neutral";
  }

  return {
    value: diff.toFixed(decimals),
    percent: percent.toFixed(1),
    direction,
  };
}

// GET /api/reports/monthly-comparison - Compare metrics between two months side by side
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const month1Str = searchParams.get("month1");
    const month2Str = searchParams.get("month2");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!month1Str || !month2Str) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Both month1 and month2 are required in YYYY-MM format (e.g., 2026-01)",
        },
        { status: 400 }
      );
    }

    const month1Range = parseMonthRange(month1Str);
    const month2Range = parseMonthRange(month2Str);

    if (!month1Range) {
      return NextResponse.json(
        { success: false, error: "Invalid month1 format. Use YYYY-MM." },
        { status: 400 }
      );
    }

    if (!month2Range) {
      return NextResponse.json(
        { success: false, error: "Invalid month2 format. Use YYYY-MM." },
        { status: 400 }
      );
    }

    // Pre-compute each client's first ever appointment date for the salon.
    // This is needed for the "newClients" metric in both months.
    const firstAppointmentRows = await db
      .select({
        clientId: appointments.clientId,
        firstDate: sql<Date>`MIN(${appointments.startTime})`.as("first_date"),
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.salonId, salonId),
          eq(appointments.status, "completed"),
          sql`${appointments.clientId} IS NOT NULL`
        )
      )
      .groupBy(appointments.clientId);

    const clientFirstAppointmentMap = new Map<string, Date>();
    for (const row of firstAppointmentRows) {
      if (row.clientId && row.firstDate) {
        clientFirstAppointmentMap.set(row.clientId, new Date(row.firstDate));
      }
    }

    // Compute metrics for both months in parallel
    const [metrics1, metrics2] = await Promise.all([
      computeMonthMetrics(
        salonId,
        month1Range.start,
        month1Range.end,
        clientFirstAppointmentMap
      ),
      computeMonthMetrics(
        salonId,
        month2Range.start,
        month2Range.end,
        clientFirstAppointmentMap
      ),
    ]);

    // Compute changes (month2 - month1)
    const changes = {
      totalRevenue: computeChange(
        parseFloat(metrics1.totalRevenue),
        parseFloat(metrics2.totalRevenue)
      ),
      totalAppointments: computeChange(
        metrics1.totalAppointments,
        metrics2.totalAppointments,
        0
      ),
      avgRevenuePerAppointment: computeChange(
        parseFloat(metrics1.avgRevenuePerAppointment),
        parseFloat(metrics2.avgRevenuePerAppointment)
      ),
      totalCancellations: computeChange(
        metrics1.totalCancellations,
        metrics2.totalCancellations,
        0
      ),
      cancellationRate: computeChange(
        parseFloat(metrics1.cancellationRate),
        parseFloat(metrics2.cancellationRate),
        1
      ),
      uniqueClients: computeChange(
        metrics1.uniqueClients,
        metrics2.uniqueClients,
        0
      ),
      newClients: computeChange(
        metrics1.newClients,
        metrics2.newClients,
        0
      ),
    };

    return NextResponse.json({
      success: true,
      data: {
        month1: {
          label: getMonthLabel(month1Str),
          period: month1Str,
          metrics: metrics1,
        },
        month2: {
          label: getMonthLabel(month2Str),
          period: month2Str,
          metrics: metrics2,
        },
        changes,
      },
    });
  } catch (error) {
    console.error("[Monthly Comparison Report API] Database error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate monthly comparison report",
      },
      { status: 500 }
    );
  }
}

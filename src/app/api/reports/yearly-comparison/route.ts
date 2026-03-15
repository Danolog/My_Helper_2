import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, services, employees } from "@/lib/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

interface YearMetrics {
  totalRevenue: string;
  totalAppointments: number;
  avgRevenuePerAppointment: string;
  totalCancellations: number;
  cancellationRate: string;
  uniqueClients: number;
  newClients: number;
  topService: { name: string; count: number } | null;
  topEmployee: { name: string; count: number } | null;
  monthlyBreakdown: MonthEntry[];
}

interface MonthEntry {
  month: number;
  monthLabel: string;
  revenue: string;
  appointments: number;
  cancellations: number;
}

interface ChangeEntry {
  value: string;
  percent: string;
  direction: "up" | "down" | "neutral";
}

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
 * Computes the delta between two numeric values (year2 - year1)
 * and returns value, percent change, and direction.
 */
function computeChange(
  val1: number,
  val2: number,
  decimals: number = 2
): ChangeEntry {
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

/**
 * Computes all metrics for a single year within the given salon.
 */
async function computeYearMetrics(
  salonId: string,
  year: number,
  clientFirstAppointmentMap: Map<string, Date>
): Promise<YearMetrics> {
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

  // Fetch all completed appointments with joined details
  const completedAppts = await db
    .select({
      appointmentId: appointments.id,
      startTime: appointments.startTime,
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
    .where(
      and(
        eq(appointments.salonId, salonId),
        eq(appointments.status, "completed"),
        gte(appointments.startTime, yearStart),
        lte(appointments.startTime, yearEnd)
      )
    );

  // Fetch cancelled + no_show appointments in this year
  const cancelledAppts = await db
    .select({
      appointmentId: appointments.id,
      startTime: appointments.startTime,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        gte(appointments.startTime, yearStart),
        lte(appointments.startTime, yearEnd),
        sql`${appointments.status} IN ('cancelled', 'no_show')`
      )
    );

  // Calculate revenue
  let totalRevenue = 0;
  for (const appt of completedAppts) {
    const price = parseFloat(appt.basePrice || "0");
    const discount = parseFloat(appt.discountAmount || "0");
    totalRevenue += Math.max(0, price - discount);
  }

  const totalAppointments = completedAppts.length;
  const totalCancellations = cancelledAppts.length;

  // Average revenue per appointment
  const avgRevenuePerAppointment =
    totalAppointments > 0 ? totalRevenue / totalAppointments : 0;

  // Cancellation rate
  const totalForRate = totalAppointments + totalCancellations;
  const cancellationRate =
    totalForRate > 0 ? (totalCancellations / totalForRate) * 100 : 0;

  // Unique clients
  const clientIdSet = new Set<string>();
  for (const appt of completedAppts) {
    if (appt.clientId) {
      clientIdSet.add(appt.clientId);
    }
  }
  const uniqueClients = clientIdSet.size;

  // New clients: clients whose FIRST EVER appointment falls within this year
  let newClients = 0;
  Array.from(clientIdSet).forEach((clientId) => {
    const firstDate = clientFirstAppointmentMap.get(clientId);
    if (firstDate && firstDate >= yearStart && firstDate <= yearEnd) {
      newClients++;
    }
  });

  // Top service by count
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

  // Top employee by count
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

  // Monthly breakdown
  const monthlyMap: Record<
    number,
    { revenue: number; appointments: number; cancellations: number }
  > = {};
  for (let m = 0; m < 12; m++) {
    monthlyMap[m] = { revenue: 0, appointments: 0, cancellations: 0 };
  }

  for (const appt of completedAppts) {
    if (appt.startTime) {
      const month = new Date(appt.startTime).getMonth();
      const price = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      monthlyMap[month]!.revenue += Math.max(0, price - discount);
      monthlyMap[month]!.appointments += 1;
    }
  }

  for (const appt of cancelledAppts) {
    if (appt.startTime) {
      const month = new Date(appt.startTime).getMonth();
      monthlyMap[month]!.cancellations += 1;
    }
  }

  const monthlyBreakdown: MonthEntry[] = [];
  for (let m = 0; m < 12; m++) {
    const entry = monthlyMap[m]!;
    monthlyBreakdown.push({
      month: m + 1,
      monthLabel: MONTH_NAMES_PL[m]!,
      revenue: entry.revenue.toFixed(2),
      appointments: entry.appointments,
      cancellations: entry.cancellations,
    });
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
    monthlyBreakdown,
  };
}

// GET /api/reports/yearly-comparison - Compare metrics between two years side by side
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const year1Str = searchParams.get("year1");
    const year2Str = searchParams.get("year2");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!year1Str || !year2Str) {
      return NextResponse.json(
        {
          success: false,
          error: "Both year1 and year2 are required as 4-digit years (e.g., 2025)",
        },
        { status: 400 }
      );
    }

    const year1 = parseInt(year1Str, 10);
    const year2 = parseInt(year2Str, 10);

    if (isNaN(year1) || isNaN(year2) || year1 < 2000 || year2 < 2000 || year1 > 2099 || year2 > 2099) {
      return NextResponse.json(
        { success: false, error: "Invalid year format. Use 4-digit year (2000-2099)." },
        { status: 400 }
      );
    }

    // Pre-compute each client's first ever appointment date for the salon
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

    // Compute metrics for both years in parallel
    const [metrics1, metrics2] = await Promise.all([
      computeYearMetrics(salonId, year1, clientFirstAppointmentMap),
      computeYearMetrics(salonId, year2, clientFirstAppointmentMap),
    ]);

    // Compute changes (year2 - year1)
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

    // Monthly comparison (month-by-month growth for revenue and appointments)
    const monthlyComparison = [];
    for (let m = 0; m < 12; m++) {
      const m1 = metrics1.monthlyBreakdown[m]!;
      const m2 = metrics2.monthlyBreakdown[m]!;
      monthlyComparison.push({
        month: m + 1,
        monthLabel: MONTH_NAMES_PL[m]!,
        year1Revenue: m1.revenue,
        year2Revenue: m2.revenue,
        revenueChange: computeChange(
          parseFloat(m1.revenue),
          parseFloat(m2.revenue)
        ),
        year1Appointments: m1.appointments,
        year2Appointments: m2.appointments,
        appointmentsChange: computeChange(
          m1.appointments,
          m2.appointments,
          0
        ),
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        year1: {
          label: String(year1),
          year: year1,
          metrics: metrics1,
        },
        year2: {
          label: String(year2),
          year: year2,
          metrics: metrics2,
        },
        changes,
        monthlyComparison,
      },
    });
  } catch (error) {
    console.error("[Yearly Comparison Report API] Database error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate yearly comparison report",
      },
      { status: 500 }
    );
  }
}

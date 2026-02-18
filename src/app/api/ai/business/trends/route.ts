import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, services, employees, clients, reviews } from "@/lib/schema";
import { eq, and, gte, lte, sql, count, avg } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/** Trend direction based on percentage change relative to a threshold. */
function classifyTrend(
  current: number,
  previous: number,
  threshold = 5
): "up" | "down" | "stable" {
  if (previous === 0) return current > 0 ? "up" : "stable";
  const changePercent = ((current - previous) / previous) * 100;
  if (changePercent > threshold) return "up";
  if (changePercent < -threshold) return "down";
  return "stable";
}

/** Percentage change between two values, handling zero denominator. */
function computeChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/** Round a number to a given number of decimal places. */
function round(value: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Returns the Monday of the week that contains the given date.
 * Uses ISO week definition (Monday = start of week).
 */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // getDay() returns 0 for Sunday, so shift to make Monday=0
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a date as YYYY-MM for monthly labels. */
function formatYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function GET(_request: Request) {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pro plan check
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro." },
      { status: 403 }
    );
  }

  try {
    const now = new Date();

    // --- Date boundaries ---

    // Current month: first day of this month to now
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Previous month: first day to last day of previous month
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    previousMonthEnd.setHours(23, 59, 59, 999);

    // Current week: Monday of this week to now
    const currentWeekStart = getMonday(now);

    // Previous week: Monday of previous week to Sunday of previous week
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekEnd = new Date(currentWeekStart);
    previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);
    previousWeekEnd.setHours(23, 59, 59, 999);

    // Last 3 months boundary (for monthly breakdown)
    const threeMonthsAgoStart = new Date(
      now.getFullYear(),
      now.getMonth() - 2,
      1
    );

    // --- Parallel database queries ---

    const [
      // Revenue: current month
      revenueCurrentMonth,
      // Revenue: previous month
      revenuePreviousMonth,
      // Revenue: current week
      revenueCurrentWeek,
      // Revenue: previous week
      revenuePreviousWeek,
      // Revenue: monthly breakdown (last 3 months)
      revenueMonthlyBreakdown,
      // Appointments: current month count
      appointmentsCurrentMonth,
      // Appointments: previous month count
      appointmentsPreviousMonth,
      // Appointments: current week count
      appointmentsCurrentWeek,
      // Appointments: previous week count
      appointmentsPreviousWeek,
      // Clients: new this month
      newClientsCurrentMonth,
      // Clients: new previous month
      newClientsPreviousMonth,
      // Clients: total
      totalClients,
      // Clients: returning this month (had appointment this month AND before this month)
      returningClientsCurrentMonth,
      // Clients: returning previous month
      returningClientsPreviousMonth,
      // Service popularity: current month
      servicePopularityCurrentMonth,
      // Service popularity: previous month
      servicePopularityPreviousMonth,
      // Employee performance: current month revenue
      employeeRevenueCurrentMonth,
      // Employee performance: previous month revenue
      employeeRevenuePreviousMonth,
      // Cancellations: current month
      cancellationsCurrentMonth,
      // Cancellations: previous month
      cancellationsPreviousMonth,
      // Total appointments current month (for cancellation rate)
      totalApptsCurrentMonth,
      // Total appointments previous month (for cancellation rate)
      totalApptsPreviousMonth,
      // Ratings: current month average
      ratingsCurrentMonth,
      // Ratings: previous month average
      ratingsPreviousMonth,
    ] = await Promise.all([
      // Revenue: current month (completed appointments)
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Revenue: previous month
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Revenue: current week
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, currentWeekStart),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Revenue: previous week
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, previousWeekStart),
            lte(appointments.startTime, previousWeekEnd)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Revenue: monthly breakdown for last 3 months
      db
        .select({
          month: sql<string>`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`,
          revenue: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, threeMonthsAgoStart),
            lte(appointments.startTime, now)
          )
        )
        .groupBy(sql`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${appointments.startTime}, 'YYYY-MM')`),

      // Appointments: current month
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Appointments: previous month
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Appointments: current week
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentWeekStart),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Appointments: previous week
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousWeekStart),
            lte(appointments.startTime, previousWeekEnd)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Clients: new this month
      db
        .select({ count: count() })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, DEMO_SALON_ID),
            gte(clients.createdAt, currentMonthStart)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Clients: new previous month
      db
        .select({ count: count() })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, DEMO_SALON_ID),
            gte(clients.createdAt, previousMonthStart),
            lte(clients.createdAt, previousMonthEnd)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Clients: total
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, DEMO_SALON_ID))
        .then((r) => r[0]?.count ?? 0),

      // Returning clients this month: clients who booked this month AND had
      // at least one completed appointment before this month
      db
        .select({
          count:
            sql<number>`COUNT(DISTINCT ${appointments.clientId})`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now),
            sql`${appointments.clientId} IN (
              SELECT DISTINCT "client_id"
              FROM "appointments"
              WHERE "salon_id" = ${DEMO_SALON_ID}
                AND "status" = 'completed'
                AND "start_time" < ${currentMonthStart.toISOString()}::timestamp
                AND "client_id" IS NOT NULL
            )`
          )
        )
        .then((r) => Number(r[0]?.count ?? 0)),

      // Returning clients previous month
      db
        .select({
          count:
            sql<number>`COUNT(DISTINCT ${appointments.clientId})`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd),
            sql`${appointments.clientId} IN (
              SELECT DISTINCT "client_id"
              FROM "appointments"
              WHERE "salon_id" = ${DEMO_SALON_ID}
                AND "status" = 'completed'
                AND "start_time" < ${previousMonthStart.toISOString()}::timestamp
                AND "client_id" IS NOT NULL
            )`
          )
        )
        .then((r) => Number(r[0]?.count ?? 0)),

      // Service popularity: current month (count per service)
      db
        .select({
          serviceId: services.id,
          serviceName: services.name,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now)
          )
        )
        .groupBy(services.id, services.name),

      // Service popularity: previous month
      db
        .select({
          serviceId: services.id,
          serviceName: services.name,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd)
          )
        )
        .groupBy(services.id, services.name),

      // Employee revenue: current month
      db
        .select({
          employeeId: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          revenue: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now)
          )
        )
        .groupBy(employees.id, employees.firstName, employees.lastName),

      // Employee revenue: previous month
      db
        .select({
          employeeId: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          revenue: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric) - COALESCE(CAST(${appointments.discountAmount} AS numeric), 0)), 0)`,
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd)
          )
        )
        .groupBy(employees.id, employees.firstName, employees.lastName),

      // Cancellations: current month (cancelled + no_show)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now),
            sql`${appointments.status} IN ('cancelled', 'no_show')`
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Cancellations: previous month
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd),
            sql`${appointments.status} IN ('cancelled', 'no_show')`
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Total appointments current month (for cancellation rate denominator)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, currentMonthStart),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Total appointments previous month (for cancellation rate denominator)
      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, previousMonthStart),
            lte(appointments.startTime, previousMonthEnd)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Ratings: current month average
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, DEMO_SALON_ID),
            gte(reviews.createdAt, currentMonthStart),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          count: r[0]?.count ?? 0,
        })),

      // Ratings: previous month average
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, DEMO_SALON_ID),
            gte(reviews.createdAt, previousMonthStart),
            lte(reviews.createdAt, previousMonthEnd),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          count: r[0]?.count ?? 0,
        })),
    ]);

    // --- Compute derived metrics ---

    // Revenue trends
    const revenueMonthlyChange = computeChange(
      revenueCurrentMonth,
      revenuePreviousMonth
    );
    const revenueWeeklyChange = computeChange(
      revenueCurrentWeek,
      revenuePreviousWeek
    );

    const revenue = {
      currentMonth: round(revenueCurrentMonth, 2),
      previousMonth: round(revenuePreviousMonth, 2),
      changePercent: round(revenueMonthlyChange),
      trend: classifyTrend(revenueCurrentMonth, revenuePreviousMonth),
      weeklyCurrentRevenue: round(revenueCurrentWeek, 2),
      weeklyPreviousRevenue: round(revenuePreviousWeek, 2),
      weeklyChangePercent: round(revenueWeeklyChange),
      weeklyTrend: classifyTrend(revenueCurrentWeek, revenuePreviousWeek),
      monthlyBreakdown: revenueMonthlyBreakdown.map((row) => ({
        month: row.month,
        revenue: round(parseFloat(row.revenue), 2),
      })),
    };

    // Appointment trends
    const appointmentsMonthlyChange = computeChange(
      appointmentsCurrentMonth,
      appointmentsPreviousMonth
    );
    const appointmentsWeeklyChange = computeChange(
      appointmentsCurrentWeek,
      appointmentsPreviousWeek
    );

    const appointmentTrends = {
      currentMonth: appointmentsCurrentMonth,
      previousMonth: appointmentsPreviousMonth,
      changePercent: round(appointmentsMonthlyChange),
      trend: classifyTrend(appointmentsCurrentMonth, appointmentsPreviousMonth),
      weeklyCurrentCount: appointmentsCurrentWeek,
      weeklyPreviousCount: appointmentsPreviousWeek,
      weeklyChangePercent: round(appointmentsWeeklyChange),
      weeklyTrend: classifyTrend(
        appointmentsCurrentWeek,
        appointmentsPreviousWeek
      ),
    };

    // Client trends
    const clientChange = computeChange(
      newClientsCurrentMonth,
      newClientsPreviousMonth
    );

    const clientTrends = {
      newClientsThisMonth: newClientsCurrentMonth,
      newClientsPrevMonth: newClientsPreviousMonth,
      changePercent: round(clientChange),
      trend: classifyTrend(newClientsCurrentMonth, newClientsPreviousMonth),
      totalClients,
      returningClientsThisMonth: returningClientsCurrentMonth,
      returningClientsPrevMonth: returningClientsPreviousMonth,
    };

    // Service popularity trends - merge current and previous month data
    const serviceCurrentMap = new Map(
      servicePopularityCurrentMonth.map((s) => [s.serviceId, s])
    );
    const servicePreviousMap = new Map(
      servicePopularityPreviousMonth.map((s) => [s.serviceId, s])
    );

    // Combine all service IDs from both periods
    const allServiceIds = new Set([
      ...serviceCurrentMap.keys(),
      ...servicePreviousMap.keys(),
    ]);

    const servicePopularity = Array.from(allServiceIds).map((serviceId) => {
      const current = serviceCurrentMap.get(serviceId);
      const previous = servicePreviousMap.get(serviceId);
      const currentCount = current?.count ?? 0;
      const previousCount = previous?.count ?? 0;
      const serviceName =
        current?.serviceName ?? previous?.serviceName ?? "Nieznana usluga";

      return {
        serviceName,
        currentCount,
        previousCount,
        changePercent: round(computeChange(currentCount, previousCount)),
        trend: classifyTrend(currentCount, previousCount),
      };
    });

    // Sort by current count descending so most popular services appear first
    servicePopularity.sort((a, b) => b.currentCount - a.currentCount);

    // Employee performance trends - merge current and previous month data
    const empCurrentMap = new Map(
      employeeRevenueCurrentMonth.map((e) => [e.employeeId, e])
    );
    const empPreviousMap = new Map(
      employeeRevenuePreviousMonth.map((e) => [e.employeeId, e])
    );

    const allEmployeeIds = new Set([
      ...empCurrentMap.keys(),
      ...empPreviousMap.keys(),
    ]);

    const employeePerformance = Array.from(allEmployeeIds).map(
      (employeeId) => {
        const current = empCurrentMap.get(employeeId);
        const previous = empPreviousMap.get(employeeId);
        const currentRevenue = parseFloat(current?.revenue ?? "0");
        const previousRevenue = parseFloat(previous?.revenue ?? "0");
        const name = current
          ? `${current.firstName} ${current.lastName}`
          : previous
            ? `${previous.firstName} ${previous.lastName}`
            : "Nieznany pracownik";

        return {
          employeeName: name,
          currentRevenue: round(currentRevenue, 2),
          previousRevenue: round(previousRevenue, 2),
          changePercent: round(computeChange(currentRevenue, previousRevenue)),
          trend: classifyTrend(currentRevenue, previousRevenue),
        };
      }
    );

    // Sort by current revenue descending
    employeePerformance.sort((a, b) => b.currentRevenue - a.currentRevenue);

    // Cancellation trends
    const currentCancellationRate =
      totalApptsCurrentMonth > 0
        ? (cancellationsCurrentMonth / totalApptsCurrentMonth) * 100
        : 0;
    const previousCancellationRate =
      totalApptsPreviousMonth > 0
        ? (cancellationsPreviousMonth / totalApptsPreviousMonth) * 100
        : 0;

    const cancellations = {
      currentRate: round(currentCancellationRate),
      previousRate: round(previousCancellationRate),
      trend: classifyTrend(currentCancellationRate, previousCancellationRate),
    };

    // Rating trends
    const ratings = {
      currentAvg: round(ratingsCurrentMonth.average, 2),
      previousAvg: round(ratingsPreviousMonth.average, 2),
      currentCount: ratingsCurrentMonth.count,
      previousCount: ratingsPreviousMonth.count,
      trend: classifyTrend(
        ratingsCurrentMonth.average,
        ratingsPreviousMonth.average
      ),
    };

    // --- Generate insights in Polish ---
    const insights: { type: "positive" | "negative" | "info"; message: string }[] = [];

    // Revenue insights
    if (revenue.trend === "up") {
      insights.push({
        type: "positive",
        message: `Przychody wzrosly o ${Math.abs(revenue.changePercent)}% w porownaniu z poprzednim miesiacem`,
      });
    } else if (revenue.trend === "down") {
      insights.push({
        type: "negative",
        message: `Przychody spadly o ${Math.abs(revenue.changePercent)}% w porownaniu z poprzednim miesiacem`,
      });
    } else {
      insights.push({
        type: "info",
        message: "Przychody utrzymuja sie na stabilnym poziomie",
      });
    }

    // Appointment insights
    if (appointmentTrends.trend === "up") {
      insights.push({
        type: "positive",
        message: `Liczba wizyt wzrosla o ${Math.abs(appointmentTrends.changePercent)}% w porownaniu z poprzednim miesiacem`,
      });
    } else if (appointmentTrends.trend === "down") {
      insights.push({
        type: "negative",
        message: `Liczba wizyt spadla o ${Math.abs(appointmentTrends.changePercent)}% w porownaniu z poprzednim miesiacem`,
      });
    }

    // New client insights
    if (newClientsCurrentMonth > 0) {
      insights.push({
        type: "info",
        message: `Pozyskano ${newClientsCurrentMonth} nowych klientow w tym miesiacu`,
      });
    }

    if (clientTrends.trend === "up" && newClientsPreviousMonth > 0) {
      insights.push({
        type: "positive",
        message: `Pozyskiwanie klientow wzroslo o ${Math.abs(clientTrends.changePercent)}% wzgledem poprzedniego miesiaca`,
      });
    } else if (clientTrends.trend === "down") {
      insights.push({
        type: "negative",
        message: `Pozyskiwanie nowych klientow spadlo o ${Math.abs(clientTrends.changePercent)}% wzgledem poprzedniego miesiaca`,
      });
    }

    // Service popularity insights - highlight declining services
    for (const svc of servicePopularity) {
      if (svc.trend === "down" && svc.previousCount > 0) {
        insights.push({
          type: "negative",
          message: `Usluga '${svc.serviceName}' odnotowala spadek popularnosci o ${Math.abs(svc.changePercent)}%`,
        });
      }
    }

    // Highlight the most growing service
    const growingServices = servicePopularity.filter(
      (s) => s.trend === "up" && s.previousCount > 0
    );
    if (growingServices.length > 0) {
      const top = growingServices.sort(
        (a, b) => b.changePercent - a.changePercent
      )[0]!;
      insights.push({
        type: "positive",
        message: `Usluga '${top.serviceName}' zyskala na popularnosci - wzrost o ${top.changePercent}%`,
      });
    }

    // Cancellation insights
    if (cancellations.trend === "down") {
      insights.push({
        type: "positive",
        message: `Wskaznik anulacji spadl z ${cancellations.previousRate}% do ${cancellations.currentRate}%`,
      });
    } else if (cancellations.trend === "up") {
      insights.push({
        type: "negative",
        message: `Wskaznik anulacji wzrosl z ${cancellations.previousRate}% do ${cancellations.currentRate}%`,
      });
    }

    // Rating insights
    if (ratings.trend === "up") {
      insights.push({
        type: "positive",
        message: `Srednia ocena wzrosla z ${ratings.previousAvg} do ${ratings.currentAvg}`,
      });
    } else if (ratings.trend === "down") {
      insights.push({
        type: "negative",
        message: `Srednia ocena spadla z ${ratings.previousAvg} do ${ratings.currentAvg}`,
      });
    }

    // Employee performance insights - highlight top performer
    if (employeePerformance.length > 0) {
      const topPerformer = employeePerformance[0]!;
      if (topPerformer.currentRevenue > 0) {
        insights.push({
          type: "info",
          message: `Najlepszy wynik przychodowy: ${topPerformer.employeeName} (${topPerformer.currentRevenue} PLN)`,
        });
      }
    }

    // --- Build period labels ---
    const period = {
      currentMonth: formatYearMonth(now),
      previousMonth: formatYearMonth(previousMonthStart),
      currentWeek: `${currentWeekStart.toISOString().split("T")[0]} - ${now.toISOString().split("T")[0]}`,
      previousWeek: `${previousWeekStart.toISOString().split("T")[0]} - ${previousWeekEnd.toISOString().split("T")[0]}`,
    };

    return NextResponse.json({
      success: true,
      data: {
        period,
        revenue,
        appointments: appointmentTrends,
        clients: clientTrends,
        servicePopularity,
        employeePerformance,
        cancellations,
        ratings,
        insights,
      },
    });
  } catch (error) {
    console.error("[AI Business Trends] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to compute business trends", details: message },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  reviews,
  products,
} from "@/lib/schema";
import { eq, and, gte, lte, sql, count, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Gather all data in parallel
    const [
      totalClients,
      totalEmployees,
      totalServices,
      recentAppointments,
      previousPeriodAppointments,
      appointmentsByStatus,
      topServices,
      topEmployees,
      recentReviews,
      avgRating,
      lowStockProducts,
      revenueData,
      previousRevenueData,
      clientsThisMonth,
    ] = await Promise.all([
      // Total clients
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, DEMO_SALON_ID))
        .then((r) => r[0]?.count ?? 0),

      // Total active employees
      db
        .select({ count: count() })
        .from(employees)
        .where(
          and(
            eq(employees.salonId, DEMO_SALON_ID),
            eq(employees.isActive, true)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Total active services
      db
        .select({ count: count() })
        .from(services)
        .where(
          and(
            eq(services.salonId, DEMO_SALON_ID),
            eq(services.isActive, true)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Recent appointments (last 30 days)
      db
        .select({
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Previous period appointments (30-60 days ago)
      db
        .select({
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      // Appointments by status (last 30 days)
      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(appointments.status),

      // Top services by appointment count (last 30 days)
      db
        .select({
          serviceName: services.name,
          servicePrice: services.basePrice,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(services.name, services.basePrice)
        .orderBy(desc(count()))
        .limit(5),

      // Top employees by appointment count (last 30 days)
      db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          count: count(),
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(employees.firstName, employees.lastName)
        .orderBy(desc(count()))
        .limit(5),

      // Recent reviews
      db
        .select({
          rating: reviews.rating,
          comment: reviews.comment,
          status: reviews.status,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(eq(reviews.salonId, DEMO_SALON_ID))
        .orderBy(desc(reviews.createdAt))
        .limit(10),

      // Average rating
      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, DEMO_SALON_ID),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0"),
          totalReviews: r[0]?.count ?? 0,
        })),

      // Low stock products
      db
        .select({
          name: products.name,
          quantity: products.quantity,
          minQuantity: products.minQuantity,
          unit: products.unit,
        })
        .from(products)
        .where(
          and(
            eq(products.salonId, DEMO_SALON_ID),
            sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`
          )
        )
        .limit(10),

      // Revenue from completed appointments (last 30 days)
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, thirtyDaysAgo),
            lte(appointments.startTime, now)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // Previous period revenue (30-60 days ago)
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, sixtyDaysAgo),
            lte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),

      // New clients this month
      db
        .select({ count: count() })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, DEMO_SALON_ID),
            gte(
              clients.createdAt,
              new Date(now.getFullYear(), now.getMonth(), 1)
            )
          )
        )
        .then((r) => r[0]?.count ?? 0),
    ]);

    // Calculate cancellation rate
    const statusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      statusMap[s.status] = s.count;
    }
    const cancelledCount = (statusMap["cancelled"] ?? 0) + (statusMap["no_show"] ?? 0);
    const cancellationRate = recentAppointments > 0
      ? ((cancelledCount / recentAppointments) * 100).toFixed(1)
      : "0";

    // Calculate growth
    const appointmentGrowth = previousPeriodAppointments > 0
      ? (((recentAppointments - previousPeriodAppointments) / previousPeriodAppointments) * 100).toFixed(1)
      : "N/A";
    const revenueGrowth = previousRevenueData > 0
      ? (((revenueData - previousRevenueData) / previousRevenueData) * 100).toFixed(1)
      : "N/A";

    const analytics = {
      generatedAt: now.toISOString(),
      period: "last_30_days",
      overview: {
        totalClients,
        totalEmployees,
        totalServices,
        newClientsThisMonth: clientsThisMonth,
      },
      appointments: {
        last30Days: recentAppointments,
        previous30Days: previousPeriodAppointments,
        growthPercent: appointmentGrowth,
        byStatus: statusMap,
        cancellationRate: `${cancellationRate}%`,
      },
      revenue: {
        last30Days: revenueData,
        previous30Days: previousRevenueData,
        growthPercent: revenueGrowth,
        currency: "PLN",
      },
      topServices,
      topEmployees,
      reviews: {
        averageRating: avgRating.average.toFixed(1),
        totalReviews: avgRating.totalReviews,
        recent: recentReviews,
      },
      inventory: {
        lowStockProducts,
        lowStockCount: lowStockProducts.length,
      },
    };

    return NextResponse.json({ success: true, analytics });
  } catch (error) {
    console.error("[AI Business Analytics] Error:", error);
    return NextResponse.json(
      { error: "Failed to gather analytics" },
      { status: 500 }
    );
  }
}

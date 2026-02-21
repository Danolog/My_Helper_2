import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  employees,
  reviews,
  services,
} from "@/lib/schema";
import { eq, and, gte, lte } from "drizzle-orm";

// GET /api/reports/employee-popularity - Employee popularity ranking report
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const format = searchParams.get("format"); // 'json' or 'csv'

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Default date range: last 90 days
    const endDate = dateTo ? new Date(dateTo) : new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = dateFrom
      ? new Date(dateFrom)
      : new Date(
          new Date().getFullYear(),
          new Date().getMonth() - 3,
          new Date().getDate()
        );

    // 1. Get all active employees for the salon
    const activeEmployees = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        color: employees.color,
      })
      .from(employees)
      .where(
        and(eq(employees.salonId, salonId), eq(employees.isActive, true))
      );

    if (activeEmployees.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          employees: [],
          summary: {
            totalEmployees: 0,
            totalBookings: 0,
            avgRetentionRate: "0.0",
            avgRating: "0.0",
          },
          filters: {
            salonId,
            dateFrom: dateFrom || startDate.toISOString().split("T")[0],
            dateTo: dateTo || endDate.toISOString().split("T")[0],
          },
        },
      });
    }

    // 2. Get all non-cancelled appointments in the date range per employee
    const employeeMetrics: {
      employeeId: string;
      employeeName: string;
      color: string | null;
      totalBookings: number;
      completedBookings: number;
      cancelledBookings: number;
      noShowBookings: number;
      uniqueClients: number;
      returningClients: number;
      retentionRate: number;
      avgRating: number;
      reviewCount: number;
      revenue: number;
      topServices: { name: string; count: number }[];
    }[] = [];

    for (const emp of activeEmployees) {
      // Get all appointments for this employee in the date range
      const empAppointments = await db
        .select({
          id: appointments.id,
          clientId: appointments.clientId,
          status: appointments.status,
          serviceId: appointments.serviceId,
          serviceName: services.name,
          basePrice: services.basePrice,
          discountAmount: appointments.discountAmount,
        })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.employeeId, emp.id),
            gte(appointments.startTime, startDate),
            lte(appointments.startTime, endDate)
          )
        );

      // Count by status
      const totalBookings = empAppointments.filter(
        (a) => a.status !== "cancelled"
      ).length;
      const completedBookings = empAppointments.filter(
        (a) => a.status === "completed"
      ).length;
      const cancelledBookings = empAppointments.filter(
        (a) => a.status === "cancelled"
      ).length;
      const noShowBookings = empAppointments.filter(
        (a) => a.status === "no_show"
      ).length;

      // Unique clients (excluding null/walk-in)
      const clientIds = empAppointments
        .filter((a) => a.clientId && a.status !== "cancelled")
        .map((a) => a.clientId!);
      const uniqueClientIds = [...new Set(clientIds)];
      const uniqueClients = uniqueClientIds.length;

      // Returning clients: clients who have booked more than once with this employee
      const clientBookingCounts: Record<string, number> = {};
      for (const cid of clientIds) {
        clientBookingCounts[cid] = (clientBookingCounts[cid] || 0) + 1;
      }
      const returningClients = Object.values(clientBookingCounts).filter(
        (count) => count > 1
      ).length;
      const retentionRate =
        uniqueClients > 0 ? (returningClients / uniqueClients) * 100 : 0;

      // Revenue from completed appointments
      let revenue = 0;
      for (const appt of empAppointments) {
        if (appt.status === "completed") {
          const price = parseFloat(appt.basePrice || "0");
          const discount = parseFloat(appt.discountAmount || "0");
          revenue += Math.max(0, price - discount);
        }
      }

      // Top services (by booking count, non-cancelled)
      const serviceCountMap: Record<string, { name: string; count: number }> =
        {};
      for (const appt of empAppointments) {
        if (appt.status !== "cancelled" && appt.serviceId) {
          const svcName = appt.serviceName || "Usluga usuneta";
          const entry = serviceCountMap[appt.serviceId];
          if (!entry) {
            serviceCountMap[appt.serviceId] = { name: svcName, count: 1 };
          } else {
            entry.count += 1;
          }
        }
      }
      const topServices = Object.values(serviceCountMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Get reviews for this employee (approved reviews in date range)
      const empReviews = await db
        .select({
          rating: reviews.rating,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            eq(reviews.employeeId, emp.id),
            eq(reviews.status, "approved"),
            gte(reviews.createdAt, startDate),
            lte(reviews.createdAt, endDate)
          )
        );

      const ratingsWithValue = empReviews.filter(
        (r) => r.rating !== null && r.rating !== undefined
      );
      const avgRating =
        ratingsWithValue.length > 0
          ? ratingsWithValue.reduce((sum, r) => sum + (r.rating || 0), 0) /
            ratingsWithValue.length
          : 0;
      const reviewCount = ratingsWithValue.length;

      employeeMetrics.push({
        employeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        color: emp.color,
        totalBookings,
        completedBookings,
        cancelledBookings,
        noShowBookings,
        uniqueClients,
        returningClients,
        retentionRate,
        avgRating,
        reviewCount,
        revenue,
        topServices,
      });
    }

    // Sort by total bookings descending (popularity ranking)
    employeeMetrics.sort((a, b) => b.totalBookings - a.totalBookings);

    // Calculate summary
    const totalBookingsAll = employeeMetrics.reduce(
      (sum, e) => sum + e.totalBookings,
      0
    );
    const avgRetentionRate =
      employeeMetrics.length > 0
        ? employeeMetrics.reduce((sum, e) => sum + e.retentionRate, 0) /
          employeeMetrics.length
        : 0;
    const employeesWithRatings = employeeMetrics.filter(
      (e) => e.reviewCount > 0
    );
    const avgRating =
      employeesWithRatings.length > 0
        ? employeesWithRatings.reduce((sum, e) => sum + e.avgRating, 0) /
          employeesWithRatings.length
        : 0;
    const totalRevenue = employeeMetrics.reduce(
      (sum, e) => sum + e.revenue,
      0
    );

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RANKING POPULARNOSCI PRACOWNIKOW");
      csvRows.push(
        `Okres,${dateFrom || startDate.toISOString().split("T")[0]},-,${dateTo || endDate.toISOString().split("T")[0]}`
      );
      csvRows.push(`Liczba pracownikow,${employeeMetrics.length}`);
      csvRows.push(`Laczna liczba rezerwacji,${totalBookingsAll}`);
      csvRows.push(
        `Srednia retencja klientow,${avgRetentionRate.toFixed(1)}%`
      );
      csvRows.push(`Srednia ocena,${avgRating.toFixed(1)}`);
      csvRows.push(`Laczny przychod,${totalRevenue.toFixed(2)} PLN`);
      csvRows.push("");

      csvRows.push("SZCZEGOLY WG PRACOWNIKA");
      csvRows.push(
        "Pozycja,Pracownik,Rezerwacje,Ukonczone,Unikalnych klientow,Powracajacy klienci,Retencja (%),Srednia ocena,Liczba opinii,Przychod (PLN)"
      );

      employeeMetrics.forEach((emp, index) => {
        csvRows.push(
          `${index + 1},"${emp.employeeName}",${emp.totalBookings},${emp.completedBookings},${emp.uniqueClients},${emp.returningClients},${emp.retentionRate.toFixed(1)},${emp.avgRating.toFixed(1)},${emp.reviewCount},${emp.revenue.toFixed(2)}`
        );
      });

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ranking-popularnosci-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        employees: employeeMetrics.map((e, index) => ({
          rank: index + 1,
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          color: e.color,
          totalBookings: e.totalBookings,
          completedBookings: e.completedBookings,
          cancelledBookings: e.cancelledBookings,
          noShowBookings: e.noShowBookings,
          uniqueClients: e.uniqueClients,
          returningClients: e.returningClients,
          retentionRate: e.retentionRate.toFixed(1),
          avgRating: e.avgRating.toFixed(1),
          reviewCount: e.reviewCount,
          revenue: e.revenue.toFixed(2),
          topServices: e.topServices,
          bookingShare:
            totalBookingsAll > 0
              ? ((e.totalBookings / totalBookingsAll) * 100).toFixed(1)
              : "0.0",
        })),
        summary: {
          totalEmployees: employeeMetrics.length,
          totalBookings: totalBookingsAll,
          avgRetentionRate: avgRetentionRate.toFixed(1),
          avgRating: avgRating.toFixed(1),
          totalRevenue: totalRevenue.toFixed(2),
        },
        filters: {
          salonId,
          dateFrom: dateFrom || startDate.toISOString().split("T")[0],
          dateTo: dateTo || endDate.toISOString().split("T")[0],
        },
      },
    });
  } catch (error) {
    console.error("[Employee Popularity Report API] Database error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate employee popularity report",
      },
      { status: 500 }
    );
  }
}

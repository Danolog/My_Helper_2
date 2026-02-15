import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, services, employees, clients, reviews, serviceCategories } from "@/lib/schema";
import { eq, and, gte, lte, desc, ne } from "drizzle-orm";

// GET /api/reports/services-popularity - Service popularity report: most booked services
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

    // Build conditions - count all non-cancelled appointments
    const conditions: ReturnType<typeof eq>[] = [
      eq(appointments.salonId, salonId),
      ne(appointments.status, "cancelled"),
    ];

    if (dateFrom) {
      conditions.push(gte(appointments.startTime, new Date(dateFrom)));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(appointments.startTime, endDate));
    }

    // Get all non-cancelled appointments with service details
    const appointmentData = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        status: appointments.status,
        serviceId: services.id,
        serviceName: services.name,
        basePrice: services.basePrice,
        baseDuration: services.baseDuration,
        categoryId: services.categoryId,
        categoryName: serviceCategories.name,
        employeeId: employees.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        clientId: clients.id,
        discountAmount: appointments.discountAmount,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id))
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime));

    // Get average ratings for services from approved reviews
    const reviewData = await db
      .select({
        appointmentId: reviews.appointmentId,
        rating: reviews.rating,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.salonId, salonId),
          eq(reviews.status, "approved")
        )
      );

    // Build a map of appointmentId -> rating
    const appointmentRatings = new Map<string, number>();
    for (const rev of reviewData) {
      if (rev.appointmentId && rev.rating) {
        appointmentRatings.set(rev.appointmentId, rev.rating);
      }
    }

    // Aggregate by service
    const serviceStats: Record<
      string,
      {
        serviceId: string;
        serviceName: string;
        categoryName: string | null;
        basePrice: number;
        baseDuration: number;
        bookingCount: number;
        completedCount: number;
        cancelledCount: number; // we already filtered out cancelled, but let's track scheduled vs completed
        revenue: number;
        uniqueClients: Set<string>;
        ratings: number[];
        employeeBreakdown: Record<string, { name: string; count: number }>;
        monthlyTrend: Record<string, number>;
      }
    > = {};

    let totalBookings = 0;

    for (const appt of appointmentData) {
      const svcId = appt.serviceId || "unknown";
      const svcName = appt.serviceName || "Usluga usuneta";
      const price = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      const effectivePrice = Math.max(0, price - discount);

      if (!serviceStats[svcId]) {
        serviceStats[svcId] = {
          serviceId: svcId,
          serviceName: svcName,
          categoryName: appt.categoryName || null,
          basePrice: price,
          baseDuration: appt.baseDuration || 0,
          bookingCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          revenue: 0,
          uniqueClients: new Set(),
          ratings: [],
          employeeBreakdown: {},
          monthlyTrend: {},
        };
      }

      const stat = serviceStats[svcId];
      stat.bookingCount += 1;
      totalBookings += 1;

      if (appt.status === "completed") {
        stat.completedCount += 1;
        stat.revenue += effectivePrice;
      }

      // Track unique clients
      if (appt.clientId) {
        stat.uniqueClients.add(appt.clientId);
      }

      // Track rating if available
      if (appt.appointmentId && appointmentRatings.has(appt.appointmentId)) {
        stat.ratings.push(appointmentRatings.get(appt.appointmentId)!);
      }

      // Track employee breakdown
      const empId = appt.employeeId || "unknown";
      const empName = appt.employeeFirstName
        ? `${appt.employeeFirstName} ${appt.employeeLastName}`
        : "Nieznany pracownik";
      if (!stat.employeeBreakdown[empId]) {
        stat.employeeBreakdown[empId] = { name: empName, count: 0 };
      }
      stat.employeeBreakdown[empId].count += 1;

      // Monthly trend
      if (appt.startTime) {
        const monthKey =
          new Date(appt.startTime).toISOString().slice(0, 7); // YYYY-MM
        stat.monthlyTrend[monthKey] = (stat.monthlyTrend[monthKey] || 0) + 1;
      }
    }

    // Build sorted service rankings (by booking count descending)
    const serviceRankings = Object.values(serviceStats)
      .map((stat, _index) => ({
        serviceId: stat.serviceId,
        serviceName: stat.serviceName,
        categoryName: stat.categoryName,
        basePrice: stat.basePrice.toFixed(2),
        baseDuration: stat.baseDuration,
        bookingCount: stat.bookingCount,
        completedCount: stat.completedCount,
        revenue: stat.revenue.toFixed(2),
        uniqueClients: stat.uniqueClients.size,
        avgRating:
          stat.ratings.length > 0
            ? (
                stat.ratings.reduce((a, b) => a + b, 0) / stat.ratings.length
              ).toFixed(1)
            : null,
        ratingCount: stat.ratings.length,
        share:
          totalBookings > 0
            ? ((stat.bookingCount / totalBookings) * 100).toFixed(1)
            : "0.0",
        topEmployee: Object.values(stat.employeeBreakdown).sort(
          (a, b) => b.count - a.count
        )[0] || null,
        monthlyTrend: Object.entries(stat.monthlyTrend)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count })),
      }))
      .sort((a, b) => b.bookingCount - a.bookingCount);

    // Add ranking position
    const rankedServices = serviceRankings.map((svc, idx) => ({
      rank: idx + 1,
      ...svc,
    }));

    // Summary stats
    const totalRevenue = rankedServices.reduce(
      (sum, s) => sum + parseFloat(s.revenue),
      0
    );
    const totalUniqueServices = rankedServices.length;
    const avgBookingsPerService =
      totalUniqueServices > 0 ? totalBookings / totalUniqueServices : 0;

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT POPULARNOSCI USLUG");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Laczna liczba rezerwacji,${totalBookings}`);
      csvRows.push(`Liczba uslug,${totalUniqueServices}`);
      csvRows.push(
        `Srednia rezerwacji na usluge,${avgBookingsPerService.toFixed(1)}`
      );
      csvRows.push(`Calkowity przychod,${totalRevenue.toFixed(2)} PLN`);
      csvRows.push("");

      csvRows.push("RANKING USLUG");
      csvRows.push(
        "Pozycja,Usluga,Kategoria,Liczba rezerwacji,Ukonczone,Przychod (PLN),Unikalni klienci,Srednia ocena,Udzial (%)"
      );
      for (const svc of rankedServices) {
        csvRows.push(
          `${svc.rank},"${svc.serviceName}","${svc.categoryName || "-"}",${svc.bookingCount},${svc.completedCount},${svc.revenue},${svc.uniqueClients},${svc.avgRating || "-"},${svc.share}`
        );
      }
      csvRows.push("");
      csvRows.push(
        `RAZEM,-,-,${totalBookings},-,${totalRevenue.toFixed(2)},-,-,100.0`
      );

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-popularnosc-uslug-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalBookings,
          totalUniqueServices,
          avgBookingsPerService: avgBookingsPerService.toFixed(1),
          totalRevenue: totalRevenue.toFixed(2),
        },
        rankings: rankedServices,
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
      },
    });
  } catch (error) {
    console.error("[Service Popularity Report API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate service popularity report" },
      { status: 500 }
    );
  }
}

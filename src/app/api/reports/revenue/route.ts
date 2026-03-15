import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, services, employees, clients } from "@/lib/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { createExcelWorkbook, excelResponseHeaders } from "@/lib/excel-export";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/reports/revenue - Revenue report with breakdowns by service/employee and trends
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeIdsParam = searchParams.get("employeeIds"); // comma-separated employee IDs
    const format = searchParams.get("format"); // 'json', 'csv', or 'xlsx'

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Build conditions - only completed appointments generate revenue
    const conditions: ReturnType<typeof eq>[] = [
      eq(appointments.salonId, salonId),
      eq(appointments.status, "completed"),
    ];

    if (dateFrom) {
      conditions.push(gte(appointments.startTime, new Date(dateFrom)));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(appointments.startTime, endDate));
    }

    // Employee filter
    const employeeIds = employeeIdsParam
      ? employeeIdsParam.split(",").filter(Boolean)
      : [];
    if (employeeIds.length > 0) {
      conditions.push(inArray(appointments.employeeId, employeeIds));
    }

    // Get all completed appointments with service and employee details
    const completedAppointments = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        serviceId: services.id,
        serviceName: services.name,
        basePrice: services.basePrice,
        employeeId: employees.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        discountAmount: appointments.discountAmount,
        depositAmount: appointments.depositAmount,
        depositPaid: appointments.depositPaid,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime));

    // Calculate total revenue
    let totalRevenue = 0;
    let totalDiscount = 0;
    const totalAppointments = completedAppointments.length;

    // Breakdown by service
    const serviceBreakdown: Record<
      string,
      {
        serviceId: string;
        serviceName: string;
        count: number;
        revenue: number;
        avgPrice: number;
      }
    > = {};

    // Breakdown by employee
    const employeeBreakdown: Record<
      string,
      {
        employeeId: string;
        employeeName: string;
        count: number;
        revenue: number;
        avgPrice: number;
      }
    > = {};

    // Daily trend data
    const dailyTrend: Record<
      string,
      {
        date: string;
        revenue: number;
        count: number;
      }
    > = {};

    for (const appt of completedAppointments) {
      const price = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      const effectivePrice = Math.max(0, price - discount);

      totalRevenue += effectivePrice;
      totalDiscount += discount;

      // Service breakdown
      const svcId = appt.serviceId || "unknown";
      const svcName = appt.serviceName || "Usluga usuneta";
      if (!serviceBreakdown[svcId]) {
        serviceBreakdown[svcId] = {
          serviceId: svcId,
          serviceName: svcName,
          count: 0,
          revenue: 0,
          avgPrice: 0,
        };
      }
      serviceBreakdown[svcId].count += 1;
      serviceBreakdown[svcId].revenue += effectivePrice;

      // Employee breakdown
      const empId = appt.employeeId || "unknown";
      const empName = appt.employeeFirstName
        ? `${appt.employeeFirstName} ${appt.employeeLastName}`
        : "Nieznany pracownik";
      if (!employeeBreakdown[empId]) {
        employeeBreakdown[empId] = {
          employeeId: empId,
          employeeName: empName,
          count: 0,
          revenue: 0,
          avgPrice: 0,
        };
      }
      employeeBreakdown[empId].count += 1;
      employeeBreakdown[empId].revenue += effectivePrice;

      // Daily trend
      const dayKey = appt.startTime
        ? (new Date(appt.startTime).toISOString().split("T")[0] ?? "unknown")
        : "unknown";
      if (!dailyTrend[dayKey]) {
        dailyTrend[dayKey] = {
          date: dayKey,
          revenue: 0,
          count: 0,
        };
      }
      dailyTrend[dayKey].revenue += effectivePrice;
      dailyTrend[dayKey].count += 1;
    }

    // Calculate averages
    for (const svc of Object.values(serviceBreakdown)) {
      svc.avgPrice = svc.count > 0 ? svc.revenue / svc.count : 0;
    }
    for (const emp of Object.values(employeeBreakdown)) {
      emp.avgPrice = emp.count > 0 ? emp.revenue / emp.count : 0;
    }

    const serviceArray = Object.values(serviceBreakdown).sort(
      (a, b) => b.revenue - a.revenue
    );
    const employeeArray = Object.values(employeeBreakdown).sort(
      (a, b) => b.revenue - a.revenue
    );
    const trendArray = Object.values(dailyTrend).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const avgRevenuePerAppointment =
      totalAppointments > 0 ? totalRevenue / totalAppointments : 0;

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      // Summary section
      csvRows.push("RAPORT PRZYCHODOW");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Calkowity przychod,${totalRevenue.toFixed(2)} PLN`);
      csvRows.push(`Laczna liczba wizyt,${totalAppointments}`);
      csvRows.push(
        `Sredni przychod na wizyte,${avgRevenuePerAppointment.toFixed(2)} PLN`
      );
      csvRows.push(`Laczna kwota znizek,${totalDiscount.toFixed(2)} PLN`);
      csvRows.push("");

      // Service breakdown
      csvRows.push("PRZYCHOD WG USLUGI");
      csvRows.push(
        "Usluga,Liczba wizyt,Przychod (PLN),Srednia cena (PLN),Udzial (%)"
      );
      for (const svc of serviceArray) {
        const share =
          totalRevenue > 0 ? ((svc.revenue / totalRevenue) * 100).toFixed(1) : "0.0";
        csvRows.push(
          `"${svc.serviceName}",${svc.count},${svc.revenue.toFixed(2)},${svc.avgPrice.toFixed(2)},${share}`
        );
      }
      csvRows.push("");

      // Employee breakdown
      csvRows.push("PRZYCHOD WG PRACOWNIKA");
      csvRows.push(
        "Pracownik,Liczba wizyt,Przychod (PLN),Srednia cena (PLN),Udzial (%)"
      );
      for (const emp of employeeArray) {
        const share =
          totalRevenue > 0 ? ((emp.revenue / totalRevenue) * 100).toFixed(1) : "0.0";
        csvRows.push(
          `"${emp.employeeName}",${emp.count},${emp.revenue.toFixed(2)},${emp.avgPrice.toFixed(2)},${share}`
        );
      }

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-przychodow-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // Excel (XLSX) export
    if (format === "xlsx") {
      const sheets = [
        {
          name: "Podsumowanie",
          headers: ["Metryka", "Wartosc"],
          rows: [
            ["Okres od", dateFrom || "poczatek"],
            ["Okres do", dateTo || "koniec"],
            ["Calkowity przychod (PLN)", totalRevenue.toFixed(2)],
            ["Laczna liczba wizyt", totalAppointments],
            ["Sredni przychod na wizyte (PLN)", avgRevenuePerAppointment.toFixed(2)],
            ["Laczna kwota znizek (PLN)", totalDiscount.toFixed(2)],
          ] as (string | number)[][],
        },
        {
          name: "Wg uslugi",
          headers: ["Usluga", "Liczba wizyt", "Przychod (PLN)", "Srednia cena (PLN)", "Udzial (%)"],
          rows: [
            ...serviceArray.map((svc) => {
              const share =
                totalRevenue > 0
                  ? ((svc.revenue / totalRevenue) * 100).toFixed(1)
                  : "0.0";
              return [
                svc.serviceName,
                svc.count,
                svc.revenue.toFixed(2),
                svc.avgPrice.toFixed(2),
                share,
              ];
            }),
            ["RAZEM", totalAppointments, totalRevenue.toFixed(2), avgRevenuePerAppointment.toFixed(2), "100.0"],
          ] as (string | number)[][],
        },
        {
          name: "Wg pracownika",
          headers: ["Pracownik", "Liczba wizyt", "Przychod (PLN)", "Srednia cena (PLN)", "Udzial (%)"],
          rows: [
            ...employeeArray.map((emp) => {
              const share =
                totalRevenue > 0
                  ? ((emp.revenue / totalRevenue) * 100).toFixed(1)
                  : "0.0";
              return [
                emp.employeeName,
                emp.count,
                emp.revenue.toFixed(2),
                emp.avgPrice.toFixed(2),
                share,
              ];
            }),
            ["RAZEM", totalAppointments, totalRevenue.toFixed(2), avgRevenuePerAppointment.toFixed(2), "100.0"],
          ] as (string | number)[][],
        },
        {
          name: "Trend dzienny",
          headers: ["Data", "Przychod (PLN)", "Liczba wizyt"],
          rows: [
            ...trendArray.map((t) => [t.date, t.revenue.toFixed(2), t.count]),
            ["RAZEM", totalRevenue.toFixed(2), totalAppointments],
          ] as (string | number)[][],
        },
      ];

      const buf = await createExcelWorkbook(sheets);
      const filename = `raport-przychodow-${dateFrom || "all"}-${dateTo || "all"}.xlsx`;
      return new Response(Buffer.from(buf), {
        status: 200,
        headers: excelResponseHeaders(filename),
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalRevenue: totalRevenue.toFixed(2),
          totalAppointments,
          avgRevenuePerAppointment: avgRevenuePerAppointment.toFixed(2),
          totalDiscount: totalDiscount.toFixed(2),
        },
        byService: serviceArray.map((s) => ({
          ...s,
          revenue: s.revenue.toFixed(2),
          avgPrice: s.avgPrice.toFixed(2),
          share:
            totalRevenue > 0
              ? ((s.revenue / totalRevenue) * 100).toFixed(1)
              : "0.0",
        })),
        byEmployee: employeeArray.map((e) => ({
          ...e,
          revenue: e.revenue.toFixed(2),
          avgPrice: e.avgPrice.toFixed(2),
          share:
            totalRevenue > 0
              ? ((e.revenue / totalRevenue) * 100).toFixed(1)
              : "0.0",
        })),
        trend: trendArray.map((t) => ({
          ...t,
          revenue: t.revenue.toFixed(2),
        })),
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          employeeIds: employeeIds.length > 0 ? employeeIds : null,
        },
      },
    });
  } catch (error) {
    console.error("[Revenue Report API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate revenue report" },
      { status: 500 }
    );
  }
}

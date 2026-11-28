import { NextResponse } from "next/server";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { createExcelWorkbook, excelResponseHeaders } from "@/lib/excel-export";
import { logger } from "@/lib/logger";
import { requireReportSalon } from "@/lib/reports/require-report-salon";
import {
  REVENUE_METHOD_LABELS,
  REVENUE_METHOD_ORDER,
  REVENUE_SOURCE_NOTE,
  appointmentRevenueCents,
  centsToAmount,
  discountCents,
  revenueShare,
  type RevenueMethod,
} from "@/lib/reports/revenue-amount";
import { appointments, services, employees, clients } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/reports/revenue - Revenue report with breakdowns by service/employee/payment method and trends
//
// Kwota wizyty z `appointmentRevenueCents`: wpisana przy zakończeniu, a bez
// zapisu płatności dawny wzór (cena minus rabat). Wszystkie sumy w groszach,
// format z dwoma miejscami dopiero na wyjściu.
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    const salonGuard = await requireReportSalon(request);
    if (salonGuard.error) return salonGuard.error;
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
    const completedAppointments = await forSalon(salonId).raw((tx) =>
      tx
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
        paidAmount: appointments.paidAmount,
        paymentMethod: appointments.paymentMethod,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime))
    );

    // Totals in grosze (integers)
    let totalRevenueCents = 0;
    let totalDiscountCents = 0;
    const totalAppointments = completedAppointments.length;

    // Breakdown by service
    const serviceBreakdown: Record<
      string,
      {
        serviceId: string;
        serviceName: string;
        count: number;
        revenueCents: number;
      }
    > = {};

    // Breakdown by employee
    const employeeBreakdown: Record<
      string,
      {
        employeeId: string;
        employeeName: string;
        count: number;
        revenueCents: number;
      }
    > = {};

    // Daily trend data
    const dailyTrend: Record<
      string,
      {
        date: string;
        revenueCents: number;
        count: number;
      }
    > = {};

    // Breakdown by payment method — always all four groups, in fixed order
    const methodBreakdown = Object.fromEntries(
      REVENUE_METHOD_ORDER.map((method) => [method, { count: 0, revenueCents: 0 }])
    ) as Record<RevenueMethod, { count: number; revenueCents: number }>;

    for (const appt of completedAppointments) {
      const { cents: effectiveCents, method } = appointmentRevenueCents(appt);

      totalRevenueCents += effectiveCents;
      totalDiscountCents += discountCents(appt.discountAmount);

      methodBreakdown[method].count += 1;
      methodBreakdown[method].revenueCents += effectiveCents;

      // Service breakdown
      const svcId = appt.serviceId || "unknown";
      const svcName = appt.serviceName || "Usługa usunięta";
      if (!serviceBreakdown[svcId]) {
        serviceBreakdown[svcId] = {
          serviceId: svcId,
          serviceName: svcName,
          count: 0,
          revenueCents: 0,
        };
      }
      serviceBreakdown[svcId].count += 1;
      serviceBreakdown[svcId].revenueCents += effectiveCents;

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
          revenueCents: 0,
        };
      }
      employeeBreakdown[empId].count += 1;
      employeeBreakdown[empId].revenueCents += effectiveCents;

      // Daily trend
      const dayKey = appt.startTime
        ? (new Date(appt.startTime).toISOString().split("T")[0] ?? "unknown")
        : "unknown";
      if (!dailyTrend[dayKey]) {
        dailyTrend[dayKey] = {
          date: dayKey,
          revenueCents: 0,
          count: 0,
        };
      }
      dailyTrend[dayKey].revenueCents += effectiveCents;
      dailyTrend[dayKey].count += 1;
    }

    /** Average in grosze, rounded to a whole grosz (count > 0). */
    const avgCents = (cents: number, count: number) =>
      count > 0 ? Math.round(cents / count) : 0;

    const serviceArray = Object.values(serviceBreakdown)
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .map((s) => ({
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        count: s.count,
        revenue: centsToAmount(s.revenueCents),
        avgPrice: centsToAmount(avgCents(s.revenueCents, s.count)),
        share: revenueShare(s.revenueCents, totalRevenueCents),
      }));
    const employeeArray = Object.values(employeeBreakdown)
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .map((e) => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        count: e.count,
        revenue: centsToAmount(e.revenueCents),
        avgPrice: centsToAmount(avgCents(e.revenueCents, e.count)),
        share: revenueShare(e.revenueCents, totalRevenueCents),
      }));
    const trendArray = Object.values(dailyTrend)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        date: t.date,
        revenue: centsToAmount(t.revenueCents),
        count: t.count,
      }));
    const paymentMethodArray = REVENUE_METHOD_ORDER.map((method) => ({
      method,
      label: REVENUE_METHOD_LABELS[method],
      count: methodBreakdown[method].count,
      revenue: centsToAmount(methodBreakdown[method].revenueCents),
      share: revenueShare(methodBreakdown[method].revenueCents, totalRevenueCents),
    }));

    const totalRevenue = centsToAmount(totalRevenueCents);
    const totalDiscount = centsToAmount(totalDiscountCents);
    const avgRevenuePerAppointment = centsToAmount(
      avgCents(totalRevenueCents, totalAppointments)
    );
    // Share of the RAZEM row in the payment method section
    const totalShare = revenueShare(totalRevenueCents, totalRevenueCents);

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      // Summary section
      csvRows.push("RAPORT PRZYCHODÓW");
      csvRows.push(
        `Okres,${dateFrom || "początek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Całkowity przychód,${totalRevenue} PLN`);
      csvRows.push(`Łączna liczba wizyt,${totalAppointments}`);
      csvRows.push(
        `Średni przychód na wizytę,${avgRevenuePerAppointment} PLN`
      );
      csvRows.push(`Łączna kwota zniżek,${totalDiscount} PLN`);
      csvRows.push(`Źródło kwot,"${REVENUE_SOURCE_NOTE}"`);
      csvRows.push("");

      // Service breakdown
      csvRows.push("PRZYCHÓD WG USŁUGI");
      csvRows.push(
        "Usługa,Liczba wizyt,Przychód (PLN),Średnia cena (PLN),Udział (%)"
      );
      for (const svc of serviceArray) {
        csvRows.push(
          `"${svc.serviceName}",${svc.count},${svc.revenue},${svc.avgPrice},${svc.share}`
        );
      }
      csvRows.push("");

      // Employee breakdown
      csvRows.push("PRZYCHÓD WG PRACOWNIKA");
      csvRows.push(
        "Pracownik,Liczba wizyt,Przychód (PLN),Średnia cena (PLN),Udział (%)"
      );
      for (const emp of employeeArray) {
        csvRows.push(
          `"${emp.employeeName}",${emp.count},${emp.revenue},${emp.avgPrice},${emp.share}`
        );
      }
      csvRows.push("");

      // Payment method breakdown
      csvRows.push("PRZYCHÓD WG METODY PŁATNOŚCI");
      csvRows.push("Metoda płatności,Liczba wizyt,Przychód (PLN),Udział (%)");
      for (const pm of paymentMethodArray) {
        csvRows.push(`"${pm.label}",${pm.count},${pm.revenue},${pm.share}`);
      }
      csvRows.push(`RAZEM,${totalAppointments},${totalRevenue},${totalShare}`);

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
          headers: ["Metryka", "Wartość"],
          rows: [
            ["Okres od", dateFrom || "początek"],
            ["Okres do", dateTo || "koniec"],
            ["Całkowity przychód (PLN)", totalRevenue],
            ["Łączna liczba wizyt", totalAppointments],
            ["Średni przychód na wizytę (PLN)", avgRevenuePerAppointment],
            ["Łączna kwota zniżek (PLN)", totalDiscount],
            ["Źródło kwot", REVENUE_SOURCE_NOTE],
          ] as (string | number)[][],
        },
        {
          name: "Wg usługi",
          headers: ["Usługa", "Liczba wizyt", "Przychód (PLN)", "Średnia cena (PLN)", "Udział (%)"],
          rows: [
            ...serviceArray.map((svc) => [
              svc.serviceName,
              svc.count,
              svc.revenue,
              svc.avgPrice,
              svc.share,
            ]),
            ["RAZEM", totalAppointments, totalRevenue, avgRevenuePerAppointment, "100.0"],
          ] as (string | number)[][],
        },
        {
          name: "Wg pracownika",
          headers: ["Pracownik", "Liczba wizyt", "Przychód (PLN)", "Średnia cena (PLN)", "Udział (%)"],
          rows: [
            ...employeeArray.map((emp) => [
              emp.employeeName,
              emp.count,
              emp.revenue,
              emp.avgPrice,
              emp.share,
            ]),
            ["RAZEM", totalAppointments, totalRevenue, avgRevenuePerAppointment, "100.0"],
          ] as (string | number)[][],
        },
        {
          name: "Wg metody płatności",
          headers: ["Metoda płatności", "Liczba wizyt", "Przychód (PLN)", "Udział (%)"],
          rows: [
            ...paymentMethodArray.map((pm) => [pm.label, pm.count, pm.revenue, pm.share]),
            ["RAZEM", totalAppointments, totalRevenue, totalShare],
          ] as (string | number)[][],
        },
        {
          name: "Trend dzienny",
          headers: ["Data", "Przychód (PLN)", "Liczba wizyt"],
          rows: [
            ...trendArray.map((t) => [t.date, t.revenue, t.count]),
            ["RAZEM", totalRevenue, totalAppointments],
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
          totalRevenue,
          totalAppointments,
          avgRevenuePerAppointment,
          totalDiscount,
        },
        byService: serviceArray,
        byEmployee: employeeArray,
        byPaymentMethod: paymentMethodArray,
        trend: trendArray,
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          employeeIds: employeeIds.length > 0 ? employeeIds : null,
        },
      },
    });
  } catch (error) {
    logger.error("[Revenue Report API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to generate revenue report" },
      { status: 500 }
    );
  }
}

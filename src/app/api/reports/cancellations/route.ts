import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, services, employees } from "@/lib/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
const DAY_LABELS_PL = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

interface CancelledApptInfo {
  appointmentId: string;
  startTime: Date | null;
  endTime: Date | null;
  status: string;
  serviceId: string | null;
  serviceName: string | null;
  basePrice: string | null;
  employeeId: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
}

// Check if a cancelled appointment's time slot was filled by a replacement
function checkReplacement(
  cancelledAppt: CancelledApptInfo,
  allAppts: CancelledApptInfo[]
): boolean {
  if (!cancelledAppt.startTime || !cancelledAppt.endTime || !cancelledAppt.employeeId) {
    return false;
  }

  const cancelledStart = new Date(cancelledAppt.startTime).getTime();
  const cancelledEnd = new Date(cancelledAppt.endTime).getTime();

  // Look for any non-cancelled appointment for the same employee
  // that overlaps at least 50% of the cancelled slot
  for (const appt of allAppts) {
    if (appt.appointmentId === cancelledAppt.appointmentId) continue;
    if (appt.status === "cancelled" || appt.status === "no_show") continue;
    if (appt.employeeId !== cancelledAppt.employeeId) continue;
    if (!appt.startTime || !appt.endTime) continue;

    const apptStart = new Date(appt.startTime).getTime();
    const apptEnd = new Date(appt.endTime).getTime();

    // Calculate overlap
    const overlapStart = Math.max(cancelledStart, apptStart);
    const overlapEnd = Math.min(cancelledEnd, apptEnd);

    if (overlapEnd > overlapStart) {
      const overlapDuration = overlapEnd - overlapStart;
      const cancelledDuration = cancelledEnd - cancelledStart;

      // If replacement covers at least 50% of the cancelled slot, consider it replaced
      if (cancelledDuration > 0 && overlapDuration / cancelledDuration >= 0.5) {
        return true;
      }
    }
  }

  return false;
}

// Helper: calculate report metrics for a given set of appointments
function calculateReportMetrics(allAppointments: CancelledApptInfo[]) {
  const totalAppointments = allAppointments.length;

  let scheduledCount = 0;
  let confirmedCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let noShowCount = 0;
  let grossLostRevenue = 0;
  let replacedRevenue = 0;
  let replacedCount = 0;

  const employeeMap: Record<
    string,
    {
      employeeId: string;
      employeeName: string;
      total: number;
      cancelled: number;
      noShow: number;
    }
  > = {};

  const serviceMap: Record<
    string,
    {
      serviceId: string;
      serviceName: string;
      total: number;
      cancelled: number;
      noShow: number;
      grossLostRevenue: number;
      replacedRevenue: number;
    }
  > = {};

  const dayOfWeekMap: Record<
    number,
    {
      dayOfWeek: number;
      dayLabel: string;
      total: number;
      cancelled: number;
    }
  > = {};

  const trendMap: Record<
    string,
    {
      date: string;
      total: number;
      cancelled: number;
      noShow: number;
      grossLostRevenue: number;
      replacedRevenue: number;
    }
  > = {};

  for (const appt of allAppointments) {
    const price = parseFloat(appt.basePrice || "0");
    const isCancelled = appt.status === "cancelled";
    const isNoShow = appt.status === "no_show";
    const isLost = isCancelled || isNoShow;

    // Count by status
    switch (appt.status) {
      case "scheduled":
        scheduledCount++;
        break;
      case "confirmed":
        confirmedCount++;
        break;
      case "completed":
        completedCount++;
        break;
      case "cancelled":
        cancelledCount++;
        break;
      case "no_show":
        noShowCount++;
        break;
    }

    // Lost revenue calculation with replacement detection
    let isReplaced = false;
    if (isLost) {
      grossLostRevenue += price;
      isReplaced = checkReplacement(appt, allAppointments);
      if (isReplaced) {
        replacedRevenue += price;
        replacedCount++;
      }
    }

    // Employee breakdown
    const empId = appt.employeeId || "unknown";
    const empName = appt.employeeFirstName
      ? `${appt.employeeFirstName} ${appt.employeeLastName}`
      : "Nieznany pracownik";
    if (!employeeMap[empId]) {
      employeeMap[empId] = {
        employeeId: empId,
        employeeName: empName,
        total: 0,
        cancelled: 0,
        noShow: 0,
      };
    }
    const empEntry = employeeMap[empId]!;
    empEntry.total += 1;
    if (isCancelled) empEntry.cancelled += 1;
    if (isNoShow) empEntry.noShow += 1;

    // Service breakdown
    const svcId = appt.serviceId || "unknown";
    const svcName = appt.serviceName || "Usluga usuneta";
    if (!serviceMap[svcId]) {
      serviceMap[svcId] = {
        serviceId: svcId,
        serviceName: svcName,
        total: 0,
        cancelled: 0,
        noShow: 0,
        grossLostRevenue: 0,
        replacedRevenue: 0,
      };
    }
    const svcEntry = serviceMap[svcId]!;
    svcEntry.total += 1;
    if (isCancelled) svcEntry.cancelled += 1;
    if (isNoShow) svcEntry.noShow += 1;
    if (isLost) {
      svcEntry.grossLostRevenue += price;
      if (isReplaced) svcEntry.replacedRevenue += price;
    }

    // Day of week breakdown
    const startDate = appt.startTime ? new Date(appt.startTime) : null;
    if (startDate) {
      const dow = startDate.getDay();
      if (!dayOfWeekMap[dow]) {
        dayOfWeekMap[dow] = {
          dayOfWeek: dow,
          dayLabel: DAY_LABELS_PL[dow] ?? "Nieznany",
          total: 0,
          cancelled: 0,
        };
      }
      const dayEntry = dayOfWeekMap[dow];
      if (dayEntry) {
        dayEntry.total += 1;
        if (isLost) dayEntry.cancelled += 1;
      }

      // Daily trend
      const dayKey = startDate.toISOString().split("T")[0] ?? "unknown";
      if (!trendMap[dayKey]) {
        trendMap[dayKey] = {
          date: dayKey,
          total: 0,
          cancelled: 0,
          noShow: 0,
          grossLostRevenue: 0,
          replacedRevenue: 0,
        };
      }
      const trendEntry = trendMap[dayKey]!;
      trendEntry.total += 1;
      if (isCancelled) trendEntry.cancelled += 1;
      if (isNoShow) trendEntry.noShow += 1;
      if (isLost) {
        trendEntry.grossLostRevenue += price;
        if (isReplaced) trendEntry.replacedRevenue += price;
      }
    }
  }

  // Derived metrics
  const cancellationCount = cancelledCount + noShowCount;
  const cancellationRate =
    totalAppointments > 0
      ? (cancellationCount / totalAppointments) * 100
      : 0;
  const netLostRevenue = grossLostRevenue - replacedRevenue;

  // By reason breakdown
  const byReason =
    cancellationCount > 0
      ? [
          {
            reason: "cancelled",
            reasonLabel: "Anulowane",
            count: cancelledCount,
            percentage: ((cancelledCount / cancellationCount) * 100).toFixed(1),
          },
          {
            reason: "no_show",
            reasonLabel: "Nieobecnosc",
            count: noShowCount,
            percentage: ((noShowCount / cancellationCount) * 100).toFixed(1),
          },
        ]
      : [
          {
            reason: "cancelled",
            reasonLabel: "Anulowane",
            count: 0,
            percentage: "0.0",
          },
          {
            reason: "no_show",
            reasonLabel: "Nieobecnosc",
            count: 0,
            percentage: "0.0",
          },
        ];

  // Sort breakdowns
  const byEmployee = Object.values(employeeMap)
    .map((emp) => ({
      ...emp,
      rate:
        emp.total > 0
          ? (((emp.cancelled + emp.noShow) / emp.total) * 100).toFixed(1)
          : "0.0",
    }))
    .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));

  const byService = Object.values(serviceMap)
    .map((svc) => ({
      ...svc,
      rate:
        svc.total > 0
          ? (((svc.cancelled + svc.noShow) / svc.total) * 100).toFixed(1)
          : "0.0",
      grossLostRevenue: svc.grossLostRevenue.toFixed(2),
      replacedRevenue: svc.replacedRevenue.toFixed(2),
      netLostRevenue: (svc.grossLostRevenue - svc.replacedRevenue).toFixed(2),
    }))
    .sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));

  const byDayOfWeek = Object.values(dayOfWeekMap)
    .map((day) => ({
      ...day,
      rate:
        day.total > 0
          ? ((day.cancelled / day.total) * 100).toFixed(1)
          : "0.0",
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  const trend = Object.values(trendMap)
    .map((t) => ({
      ...t,
      rate:
        t.total > 0
          ? (((t.cancelled + t.noShow) / t.total) * 100).toFixed(1)
          : "0.0",
      grossLostRevenue: t.grossLostRevenue.toFixed(2),
      replacedRevenue: t.replacedRevenue.toFixed(2),
      netLostRevenue: (t.grossLostRevenue - t.replacedRevenue).toFixed(2),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary: {
      totalAppointments,
      cancellationCount,
      cancellationRate: cancellationRate.toFixed(1),
      cancelledCount,
      noShowCount,
      completedCount,
      scheduledCount,
      confirmedCount,
      // Lost revenue with replacement consideration
      grossLostRevenue: grossLostRevenue.toFixed(2),
      replacedRevenue: replacedRevenue.toFixed(2),
      netLostRevenue: netLostRevenue.toFixed(2),
      replacedCount,
      // Keep backward compat
      lostRevenue: netLostRevenue.toFixed(2),
    },
    byReason,
    byEmployee,
    byService,
    byDayOfWeek,
    trend,
  };
}

// GET /api/reports/cancellations - Cancellation rate analysis with lost revenue & period comparison
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeIdsParam = searchParams.get("employeeIds"); // comma-separated employee IDs
    const compareDateFrom = searchParams.get("compareDateFrom");
    const compareDateTo = searchParams.get("compareDateTo");
    const format = searchParams.get("format"); // 'json' or 'csv'

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Parse employee IDs filter
    const employeeIds = employeeIdsParam
      ? employeeIdsParam.split(",").filter(Boolean)
      : [];

    // Helper to fetch appointments for a date range
    async function fetchAppointments(from: string | null, to: string | null) {
      const conditions: ReturnType<typeof eq>[] = [
        eq(appointments.salonId, salonId!),
      ];

      if (from) {
        conditions.push(gte(appointments.startTime, new Date(from)));
      }
      if (to) {
        const endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(lte(appointments.startTime, endDate));
      }

      if (employeeIds.length > 0) {
        conditions.push(inArray(appointments.employeeId, employeeIds));
      }

      return db
        .select({
          appointmentId: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          status: appointments.status,
          serviceId: services.id,
          serviceName: services.name,
          basePrice: services.basePrice,
          employeeId: employees.id,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
        })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .where(and(...conditions));
    }

    // Fetch primary period appointments
    const allAppointments = await fetchAppointments(dateFrom, dateTo);
    const metrics = calculateReportMetrics(allAppointments);

    // Fetch comparison period if requested
    let comparison = null;
    if (compareDateFrom && compareDateTo) {
      const compareAppointments = await fetchAppointments(compareDateFrom, compareDateTo);
      const compareMetrics = calculateReportMetrics(compareAppointments);

      // Calculate deltas
      const currentNet = parseFloat(metrics.summary.netLostRevenue);
      const compareNet = parseFloat(compareMetrics.summary.netLostRevenue);
      const revenueChange = currentNet - compareNet;
      const revenueChangePercent = compareNet > 0
        ? ((revenueChange / compareNet) * 100).toFixed(1)
        : currentNet > 0 ? "100.0" : "0.0";

      const currentRate = parseFloat(metrics.summary.cancellationRate);
      const compareRate = parseFloat(compareMetrics.summary.cancellationRate);
      const rateChange = currentRate - compareRate;

      comparison = {
        period: {
          dateFrom: compareDateFrom,
          dateTo: compareDateTo,
        },
        summary: compareMetrics.summary,
        deltas: {
          netLostRevenue: revenueChange.toFixed(2),
          netLostRevenuePercent: revenueChangePercent,
          cancellationRate: rateChange.toFixed(1),
          cancellationCount: metrics.summary.cancellationCount - compareMetrics.summary.cancellationCount,
          totalAppointments: metrics.summary.totalAppointments - compareMetrics.summary.totalAppointments,
        },
      };
    }

    // --- CSV export ---
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT UTRACONEGO PRZYCHODU Z ANULACJI");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Laczna liczba wizyt,${metrics.summary.totalAppointments}`);
      csvRows.push(`Anulowane + nieobecnosci,${metrics.summary.cancellationCount}`);
      csvRows.push(`Wskaznik anulacji,${metrics.summary.cancellationRate}%`);
      csvRows.push(`Anulowane,${metrics.summary.cancelledCount}`);
      csvRows.push(`Nieobecnosci (no-show),${metrics.summary.noShowCount}`);
      csvRows.push(`Zrealizowane,${metrics.summary.completedCount}`);
      csvRows.push("");
      csvRows.push("UTRACONY PRZYCHOD");
      csvRows.push(`Calkowita wartosc anulowanych wizyt,${metrics.summary.grossLostRevenue} PLN`);
      csvRows.push(`Wartosc zastapiona (nowe wizyty w tym samym terminie),${metrics.summary.replacedRevenue} PLN`);
      csvRows.push(`Liczba zastąpionych wizyt,${metrics.summary.replacedCount}`);
      csvRows.push(`Rzeczywisty utracony przychod,${metrics.summary.netLostRevenue} PLN`);
      csvRows.push("");

      if (comparison) {
        csvRows.push("POROWNANIE OKRESOW");
        csvRows.push(`Okres porownawczy,${compareDateFrom},-,${compareDateTo}`);
        csvRows.push(`Utracony przychod (porownawczy),${comparison.summary.netLostRevenue} PLN`);
        csvRows.push(`Zmiana,${comparison.deltas.netLostRevenue} PLN (${comparison.deltas.netLostRevenuePercent}%)`);
        csvRows.push(`Wskaznik anulacji (porownawczy),${comparison.summary.cancellationRate}%`);
        csvRows.push(`Zmiana wskaznika,${comparison.deltas.cancellationRate} pp`);
        csvRows.push("");
      }

      // By reason
      csvRows.push("WG POWODU");
      csvRows.push("Powod,Liczba,Udzial (%)");
      for (const r of metrics.byReason) {
        csvRows.push(`"${r.reasonLabel}",${r.count},${r.percentage}`);
      }
      csvRows.push("");

      // By employee
      csvRows.push("WG PRACOWNIKA");
      csvRows.push(
        "Pracownik,Laczna liczba wizyt,Anulowane,Nieobecnosci,Wskaznik (%)"
      );
      for (const emp of metrics.byEmployee) {
        csvRows.push(
          `"${emp.employeeName}",${emp.total},${emp.cancelled},${emp.noShow},${emp.rate}`
        );
      }
      csvRows.push("");

      // By service
      csvRows.push("WG USLUGI");
      csvRows.push(
        "Usluga,Laczna liczba wizyt,Anulowane,Nieobecnosci,Wskaznik (%),Calkowity utracony,Zastapiony,Rzeczywisty utracony (PLN)"
      );
      for (const svc of metrics.byService) {
        csvRows.push(
          `"${svc.serviceName}",${svc.total},${svc.cancelled},${svc.noShow},${svc.rate},${svc.grossLostRevenue},${svc.replacedRevenue},${svc.netLostRevenue}`
        );
      }
      csvRows.push("");

      // By day of week
      csvRows.push("WG DNIA TYGODNIA");
      csvRows.push("Dzien,Laczna liczba wizyt,Anulowane + nieobecnosci,Wskaznik (%)");
      for (const day of metrics.byDayOfWeek) {
        csvRows.push(
          `"${day.dayLabel}",${day.total},${day.cancelled},${day.rate}`
        );
      }

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-utracony-przychod-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // --- JSON response ---
    return NextResponse.json({
      success: true,
      data: {
        ...metrics,
        comparison,
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          compareDateFrom: compareDateFrom || null,
          compareDateTo: compareDateTo || null,
        },
      },
    });
  } catch (error) {
    logger.error("[Cancellation Report API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to generate cancellation report" },
      { status: 500 }
    );
  }
}

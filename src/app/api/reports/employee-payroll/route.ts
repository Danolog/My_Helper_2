import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  services,
  employees,
  employeeCommissions,
} from "@/lib/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { createExcelWorkbook, excelResponseHeaders } from "@/lib/excel-export";

// GET /api/reports/employee-payroll - Employee payroll report with hours, commissions, and service breakdown
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeIdsParam = searchParams.get("employeeIds");
    const format = searchParams.get("format"); // 'json', 'csv', or 'xlsx'

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Build conditions for completed appointments
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

    // Get all completed appointments with service, employee, and commission details
    const completedAppointments = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        serviceId: services.id,
        serviceName: services.name,
        basePrice: services.basePrice,
        baseDuration: services.baseDuration,
        employeeId: employees.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        discountAmount: appointments.discountAmount,
        commissionAmount: employeeCommissions.amount,
        commissionPercentage: employeeCommissions.percentage,
        commissionPaidAt: employeeCommissions.paidAt,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(
        employeeCommissions,
        eq(appointments.id, employeeCommissions.appointmentId)
      )
      .where(and(...conditions));

    // Build per-employee payroll data
    const employeePayroll: Record<
      string,
      {
        employeeId: string;
        employeeName: string;
        completedAppointments: number;
        totalHoursWorked: number; // in minutes, will convert later
        totalRevenue: number; // revenue generated (service prices)
        totalCommission: number; // total commission earned
        paidCommission: number; // commission already paid out
        unpaidCommission: number; // commission still owed
        avgCommissionRate: number; // average commission percentage
        commissionRates: number[]; // to calculate average
        services: Record<
          string,
          {
            serviceId: string;
            serviceName: string;
            count: number;
            revenue: number;
            commission: number;
          }
        >;
      }
    > = {};

    for (const appt of completedAppointments) {
      const empId = appt.employeeId || "unknown";
      const empName = appt.employeeFirstName
        ? `${appt.employeeFirstName} ${appt.employeeLastName}`
        : "Nieznany pracownik";

      if (!employeePayroll[empId]) {
        employeePayroll[empId] = {
          employeeId: empId,
          employeeName: empName,
          completedAppointments: 0,
          totalHoursWorked: 0,
          totalRevenue: 0,
          totalCommission: 0,
          paidCommission: 0,
          unpaidCommission: 0,
          avgCommissionRate: 0,
          commissionRates: [],
          services: {},
        };
      }

      const emp = employeePayroll[empId];
      emp.completedAppointments += 1;

      // Calculate duration in minutes
      if (appt.startTime && appt.endTime) {
        const durationMs =
          new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
        emp.totalHoursWorked += durationMs / (1000 * 60); // minutes
      } else if (appt.baseDuration) {
        emp.totalHoursWorked += appt.baseDuration;
      }

      // Revenue
      const price = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      const effectivePrice = Math.max(0, price - discount);
      emp.totalRevenue += effectivePrice;

      // Commission
      const commissionAmt = parseFloat(appt.commissionAmount || "0");
      emp.totalCommission += commissionAmt;

      if (appt.commissionPaidAt) {
        emp.paidCommission += commissionAmt;
      } else if (commissionAmt > 0) {
        emp.unpaidCommission += commissionAmt;
      }

      // Track commission rates for averaging
      const commRate = parseFloat(appt.commissionPercentage || "0");
      if (commRate > 0) {
        emp.commissionRates.push(commRate);
      }

      // Service breakdown per employee
      const svcId = appt.serviceId || "unknown";
      const svcName = appt.serviceName || "Usluga usunieta";
      if (!emp.services[svcId]) {
        emp.services[svcId] = {
          serviceId: svcId,
          serviceName: svcName,
          count: 0,
          revenue: 0,
          commission: 0,
        };
      }
      emp.services[svcId].count += 1;
      emp.services[svcId].revenue += effectivePrice;
      emp.services[svcId].commission += commissionAmt;
    }

    // Calculate averages and format
    const employeeArray = Object.values(employeePayroll)
      .map((emp) => {
        emp.avgCommissionRate =
          emp.commissionRates.length > 0
            ? emp.commissionRates.reduce((a, b) => a + b, 0) /
              emp.commissionRates.length
            : 0;
        return emp;
      })
      .sort((a, b) => b.totalCommission - a.totalCommission);

    // Summary totals
    const totalCompletedAppointments = employeeArray.reduce(
      (sum, e) => sum + e.completedAppointments,
      0
    );
    const totalHoursWorked = employeeArray.reduce(
      (sum, e) => sum + e.totalHoursWorked,
      0
    );
    const totalRevenue = employeeArray.reduce(
      (sum, e) => sum + e.totalRevenue,
      0
    );
    const totalCommission = employeeArray.reduce(
      (sum, e) => sum + e.totalCommission,
      0
    );
    const totalPaidCommission = employeeArray.reduce(
      (sum, e) => sum + e.paidCommission,
      0
    );
    const totalUnpaidCommission = employeeArray.reduce(
      (sum, e) => sum + e.unpaidCommission,
      0
    );

    const formatHours = (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return `${h}h ${m}min`;
    };

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT WYNAGRODZEN PRACOWNIKOW");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(
        `Calkowity przychod,${totalRevenue.toFixed(2)} PLN`
      );
      csvRows.push(
        `Calkowita prowizja,${totalCommission.toFixed(2)} PLN`
      );
      csvRows.push(
        `Wyplacona prowizja,${totalPaidCommission.toFixed(2)} PLN`
      );
      csvRows.push(
        `Do wyplaty,${totalUnpaidCommission.toFixed(2)} PLN`
      );
      csvRows.push(
        `Laczna liczba wizyt,${totalCompletedAppointments}`
      );
      csvRows.push(`Laczny czas pracy,${formatHours(totalHoursWorked)}`);
      csvRows.push("");

      csvRows.push("WYNAGRODZENIA WG PRACOWNIKA");
      csvRows.push(
        "Pracownik,Wizyty,Czas pracy,Przychod (PLN),Prowizja (PLN),Wyplacona (PLN),Do wyplaty (PLN),Srednia stawka (%)"
      );
      for (const emp of employeeArray) {
        csvRows.push(
          `"${emp.employeeName}",${emp.completedAppointments},${formatHours(emp.totalHoursWorked)},${emp.totalRevenue.toFixed(2)},${emp.totalCommission.toFixed(2)},${emp.paidCommission.toFixed(2)},${emp.unpaidCommission.toFixed(2)},${emp.avgCommissionRate.toFixed(1)}`
        );
      }
      csvRows.push(
        `RAZEM,${totalCompletedAppointments},${formatHours(totalHoursWorked)},${totalRevenue.toFixed(2)},${totalCommission.toFixed(2)},${totalPaidCommission.toFixed(2)},${totalUnpaidCommission.toFixed(2)},`
      );
      csvRows.push("");

      // Service breakdown per employee
      for (const emp of employeeArray) {
        const serviceList = Object.values(emp.services).sort(
          (a, b) => b.revenue - a.revenue
        );
        if (serviceList.length > 0) {
          csvRows.push(`USLUGI - ${emp.employeeName}`);
          csvRows.push("Usluga,Liczba,Przychod (PLN),Prowizja (PLN)");
          for (const svc of serviceList) {
            csvRows.push(
              `"${svc.serviceName}",${svc.count},${svc.revenue.toFixed(2)},${svc.commission.toFixed(2)}`
            );
          }
          csvRows.push("");
        }
      }

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-wynagrodzen-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
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
            ["Calkowita prowizja (PLN)", totalCommission.toFixed(2)],
            ["Wyplacona prowizja (PLN)", totalPaidCommission.toFixed(2)],
            ["Do wyplaty (PLN)", totalUnpaidCommission.toFixed(2)],
            ["Laczna liczba wizyt", totalCompletedAppointments],
            ["Laczny czas pracy", formatHours(totalHoursWorked)],
          ] as (string | number)[][],
        },
        {
          name: "Wg pracownika",
          headers: [
            "Pracownik",
            "Wizyty",
            "Czas pracy",
            "Przychod (PLN)",
            "Prowizja (PLN)",
            "Wyplacona (PLN)",
            "Do wyplaty (PLN)",
            "Srednia stawka (%)",
          ],
          rows: [
            ...employeeArray.map((emp) => [
              emp.employeeName,
              emp.completedAppointments,
              formatHours(emp.totalHoursWorked),
              emp.totalRevenue.toFixed(2),
              emp.totalCommission.toFixed(2),
              emp.paidCommission.toFixed(2),
              emp.unpaidCommission.toFixed(2),
              emp.avgCommissionRate.toFixed(1),
            ]),
            [
              "RAZEM",
              totalCompletedAppointments,
              formatHours(totalHoursWorked),
              totalRevenue.toFixed(2),
              totalCommission.toFixed(2),
              totalPaidCommission.toFixed(2),
              totalUnpaidCommission.toFixed(2),
              "",
            ],
          ] as (string | number)[][],
        },
      ];

      const buf = await createExcelWorkbook(sheets);
      const filename = `raport-wynagrodzen-${dateFrom || "all"}-${dateTo || "all"}.xlsx`;
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
          totalCompletedAppointments,
          totalHoursWorked: formatHours(totalHoursWorked),
          totalHoursWorkedMinutes: Math.round(totalHoursWorked),
          totalRevenue: totalRevenue.toFixed(2),
          totalCommission: totalCommission.toFixed(2),
          paidCommission: totalPaidCommission.toFixed(2),
          unpaidCommission: totalUnpaidCommission.toFixed(2),
        },
        byEmployee: employeeArray.map((emp) => ({
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          completedAppointments: emp.completedAppointments,
          hoursWorked: formatHours(emp.totalHoursWorked),
          hoursWorkedMinutes: Math.round(emp.totalHoursWorked),
          totalRevenue: emp.totalRevenue.toFixed(2),
          totalCommission: emp.totalCommission.toFixed(2),
          paidCommission: emp.paidCommission.toFixed(2),
          unpaidCommission: emp.unpaidCommission.toFixed(2),
          avgCommissionRate: emp.avgCommissionRate.toFixed(1),
          services: Object.values(emp.services)
            .sort((a, b) => b.revenue - a.revenue)
            .map((svc) => ({
              serviceId: svc.serviceId,
              serviceName: svc.serviceName,
              count: svc.count,
              revenue: svc.revenue.toFixed(2),
              commission: svc.commission.toFixed(2),
            })),
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
    console.error("[Employee Payroll Report API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate employee payroll report" },
      { status: 500 }
    );
  }
}

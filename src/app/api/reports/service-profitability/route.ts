import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  services,
  employees,
  appointmentMaterials,
  products,
  employeeCommissions,
} from "@/lib/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/reports/service-profitability - Service profit margins report
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

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

    // 1. Get all completed appointments with service and employee details
    const completedAppointments = await db
      .select({
        appointmentId: appointments.id,
        startTime: appointments.startTime,
        serviceId: services.id,
        serviceName: services.name,
        basePrice: services.basePrice,
        baseDuration: services.baseDuration,
        employeeId: employees.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        discountAmount: appointments.discountAmount,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime));

    // 2. Get all material usage for these appointments
    const appointmentIds = completedAppointments.map((a) => a.appointmentId);

    // Build maps: appointmentId -> total cost
    const materialCostByAppointment: Record<string, number> = {};
    const laborCostByAppointment: Record<string, number> = {};

    if (appointmentIds.length > 0) {
      // Get material usage records for completed appointments
      const materialUsage = await db
        .select({
          appointmentId: appointmentMaterials.appointmentId,
          quantityUsed: appointmentMaterials.quantityUsed,
          pricePerUnit: products.pricePerUnit,
        })
        .from(appointmentMaterials)
        .innerJoin(products, eq(appointmentMaterials.productId, products.id))
        .where(inArray(appointmentMaterials.appointmentId, appointmentIds));

      for (const usage of materialUsage) {
        const cost =
          parseFloat(usage.quantityUsed) *
          parseFloat(usage.pricePerUnit || "0");
        materialCostByAppointment[usage.appointmentId] =
          (materialCostByAppointment[usage.appointmentId] || 0) + cost;
      }

      // 3. Get commissions for these appointments (labor costs)
      const commissions = await db
        .select({
          appointmentId: employeeCommissions.appointmentId,
          amount: employeeCommissions.amount,
        })
        .from(employeeCommissions)
        .where(inArray(employeeCommissions.appointmentId, appointmentIds));

      for (const comm of commissions) {
        laborCostByAppointment[comm.appointmentId] =
          (laborCostByAppointment[comm.appointmentId] || 0) +
          parseFloat(comm.amount);
      }
    }

    // 4. Aggregate by service
    interface ServiceProfitData {
      serviceId: string;
      serviceName: string;
      baseDuration: number;
      appointmentCount: number;
      totalRevenue: number;
      totalMaterialCost: number;
      totalLaborCost: number;
      totalProfit: number;
      avgRevenue: number;
      avgMaterialCost: number;
      avgLaborCost: number;
      avgProfit: number;
      profitMargin: number;
    }

    const serviceMap: Record<string, ServiceProfitData> = {};

    let grandTotalRevenue = 0;
    let grandTotalMaterialCost = 0;
    let grandTotalLaborCost = 0;
    let grandTotalProfit = 0;
    const totalAppointments = completedAppointments.length;

    for (const appt of completedAppointments) {
      const svcId = appt.serviceId || "unknown";
      const svcName = appt.serviceName || "Usluga usuneta";
      const duration = appt.baseDuration || 0;

      const price = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      const revenue = Math.max(0, price - discount);

      const materialCost =
        materialCostByAppointment[appt.appointmentId] || 0;
      const laborCost = laborCostByAppointment[appt.appointmentId] || 0;
      const profit = revenue - materialCost - laborCost;

      if (!serviceMap[svcId]) {
        serviceMap[svcId] = {
          serviceId: svcId,
          serviceName: svcName,
          baseDuration: duration,
          appointmentCount: 0,
          totalRevenue: 0,
          totalMaterialCost: 0,
          totalLaborCost: 0,
          totalProfit: 0,
          avgRevenue: 0,
          avgMaterialCost: 0,
          avgLaborCost: 0,
          avgProfit: 0,
          profitMargin: 0,
        };
      }

      serviceMap[svcId].appointmentCount += 1;
      serviceMap[svcId].totalRevenue += revenue;
      serviceMap[svcId].totalMaterialCost += materialCost;
      serviceMap[svcId].totalLaborCost += laborCost;
      serviceMap[svcId].totalProfit += profit;

      grandTotalRevenue += revenue;
      grandTotalMaterialCost += materialCost;
      grandTotalLaborCost += laborCost;
      grandTotalProfit += profit;
    }

    // Calculate averages and margins
    for (const svc of Object.values(serviceMap)) {
      if (svc.appointmentCount > 0) {
        svc.avgRevenue = svc.totalRevenue / svc.appointmentCount;
        svc.avgMaterialCost = svc.totalMaterialCost / svc.appointmentCount;
        svc.avgLaborCost = svc.totalLaborCost / svc.appointmentCount;
        svc.avgProfit = svc.totalProfit / svc.appointmentCount;
        svc.profitMargin =
          svc.totalRevenue > 0
            ? (svc.totalProfit / svc.totalRevenue) * 100
            : 0;
      }
    }

    // Sort by total profit descending
    const serviceArray = Object.values(serviceMap).sort(
      (a, b) => b.totalProfit - a.totalProfit
    );

    const grandProfitMargin =
      grandTotalRevenue > 0
        ? (grandTotalProfit / grandTotalRevenue) * 100
        : 0;

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT RENTOWNOSCI USLUG");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Calkowity przychod,${grandTotalRevenue.toFixed(2)} PLN`);
      csvRows.push(
        `Koszty materialow,${grandTotalMaterialCost.toFixed(2)} PLN`
      );
      csvRows.push(`Koszty pracy,${grandTotalLaborCost.toFixed(2)} PLN`);
      csvRows.push(`Zysk calkowity,${grandTotalProfit.toFixed(2)} PLN`);
      csvRows.push(`Marza,${grandProfitMargin.toFixed(1)}%`);
      csvRows.push(`Liczba wizyt,${totalAppointments}`);
      csvRows.push("");

      csvRows.push("RENTOWNOSC WG USLUGI");
      csvRows.push(
        "Usluga,Liczba wizyt,Przychod (PLN),Koszty materialow (PLN),Koszty pracy (PLN),Zysk (PLN),Marza (%)"
      );
      for (const svc of serviceArray) {
        csvRows.push(
          `"${svc.serviceName}",${svc.appointmentCount},${svc.totalRevenue.toFixed(2)},${svc.totalMaterialCost.toFixed(2)},${svc.totalLaborCost.toFixed(2)},${svc.totalProfit.toFixed(2)},${svc.profitMargin.toFixed(1)}`
        );
      }
      csvRows.push("");
      csvRows.push(
        `"RAZEM",${totalAppointments},${grandTotalRevenue.toFixed(2)},${grandTotalMaterialCost.toFixed(2)},${grandTotalLaborCost.toFixed(2)},${grandTotalProfit.toFixed(2)},${grandProfitMargin.toFixed(1)}`
      );

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-rentownosci-uslug-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalRevenue: grandTotalRevenue.toFixed(2),
          totalMaterialCost: grandTotalMaterialCost.toFixed(2),
          totalLaborCost: grandTotalLaborCost.toFixed(2),
          totalProfit: grandTotalProfit.toFixed(2),
          profitMargin: grandProfitMargin.toFixed(1),
          totalAppointments,
        },
        byService: serviceArray.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          baseDuration: s.baseDuration,
          appointmentCount: s.appointmentCount,
          totalRevenue: s.totalRevenue.toFixed(2),
          totalMaterialCost: s.totalMaterialCost.toFixed(2),
          totalLaborCost: s.totalLaborCost.toFixed(2),
          totalProfit: s.totalProfit.toFixed(2),
          profitMargin: s.profitMargin.toFixed(1),
          avgRevenue: s.avgRevenue.toFixed(2),
          avgMaterialCost: s.avgMaterialCost.toFixed(2),
          avgLaborCost: s.avgLaborCost.toFixed(2),
          avgProfit: s.avgProfit.toFixed(2),
          revenueShare:
            grandTotalRevenue > 0
              ? ((s.totalRevenue / grandTotalRevenue) * 100).toFixed(1)
              : "0.0",
        })),
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
      },
    });
  } catch (error) {
    console.error("[Service Profitability Report API] Database error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate service profitability report",
      },
      { status: 500 }
    );
  }
}

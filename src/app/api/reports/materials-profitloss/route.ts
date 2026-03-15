import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointmentMaterials,
  products,
  appointments,
  employees,
  services,
} from "@/lib/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/reports/materials-profitloss - Material profit/loss report
// Tracks product costs vs. revenue generated from appointments using those products
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

    // Build date conditions for appointment materials
    const conditions: ReturnType<typeof eq>[] = [
      eq(products.salonId, salonId),
    ];

    if (dateFrom) {
      conditions.push(
        gte(appointmentMaterials.createdAt, new Date(dateFrom))
      );
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(appointmentMaterials.createdAt, endDate));
    }

    // 1. Get all material usage records with product, appointment, and service details
    const usageRecords = await db
      .select({
        usageId: appointmentMaterials.id,
        productId: products.id,
        productName: products.name,
        productCategory: products.category,
        productUnit: products.unit,
        pricePerUnit: products.pricePerUnit,
        currentStock: products.quantity,
        quantityUsed: appointmentMaterials.quantityUsed,
        usageDate: appointmentMaterials.createdAt,
        appointmentId: appointments.id,
        appointmentDate: appointments.startTime,
        appointmentStatus: appointments.status,
        serviceBasePrice: services.basePrice,
        serviceName: services.name,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        discountAmount: appointments.discountAmount,
      })
      .from(appointmentMaterials)
      .innerJoin(products, eq(appointmentMaterials.productId, products.id))
      .innerJoin(
        appointments,
        eq(appointmentMaterials.appointmentId, appointments.id)
      )
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(...conditions))
      .orderBy(desc(appointmentMaterials.createdAt));

    // 2. For each appointment, count how many different products were used
    //    (to split revenue proportionally among products)
    const appointmentMaterialCounts: Record<string, number> = {};
    const appointmentTotalMaterialCost: Record<string, number> = {};

    for (const record of usageRecords) {
      const aid = record.appointmentId;
      appointmentMaterialCounts[aid] =
        (appointmentMaterialCounts[aid] || 0) + 1;

      const materialCost =
        parseFloat(record.quantityUsed) *
        parseFloat(record.pricePerUnit || "0");
      appointmentTotalMaterialCost[aid] =
        (appointmentTotalMaterialCost[aid] || 0) + materialCost;
    }

    // 3. Aggregate per product: cost, attributed revenue, profit/loss
    interface ProductProfitData {
      productId: string;
      productName: string;
      category: string | null;
      unit: string | null;
      pricePerUnit: string | null;
      currentStock: string | null;
      totalQuantityUsed: number;
      totalMaterialCost: number;
      attributedRevenue: number;
      profitLoss: number;
      profitMargin: number;
      usageCount: number;
      avgCostPerUse: number;
      avgRevenuePerUse: number;
    }

    const productMap: Record<string, ProductProfitData> = {};

    for (const record of usageRecords) {
      const pid = record.productId;
      const aid = record.appointmentId;

      // Material cost for this usage
      const qty = parseFloat(record.quantityUsed);
      const materialCost = qty * parseFloat(record.pricePerUnit || "0");

      // Attributed revenue: service price (minus discount) divided proportionally
      // by material cost contribution in this appointment
      const servicePrice = parseFloat(record.serviceBasePrice || "0");
      const discount = parseFloat(record.discountAmount || "0");
      const netRevenue = Math.max(0, servicePrice - discount);

      // Attribute revenue proportionally based on material cost share
      const totalMatCostInAppt = appointmentTotalMaterialCost[aid] || 0;
      let attributedRevenue = 0;
      if (totalMatCostInAppt > 0) {
        attributedRevenue = (materialCost / totalMatCostInAppt) * netRevenue;
      } else if ((appointmentMaterialCounts[aid] ?? 0) > 0) {
        // Equal split if all materials have 0 cost
        attributedRevenue = netRevenue / (appointmentMaterialCounts[aid] ?? 1);
      }

      if (!productMap[pid]) {
        productMap[pid] = {
          productId: pid,
          productName: record.productName,
          category: record.productCategory,
          unit: record.productUnit,
          pricePerUnit: record.pricePerUnit,
          currentStock: record.currentStock,
          totalQuantityUsed: 0,
          totalMaterialCost: 0,
          attributedRevenue: 0,
          profitLoss: 0,
          profitMargin: 0,
          usageCount: 0,
          avgCostPerUse: 0,
          avgRevenuePerUse: 0,
        };
      }

      productMap[pid].totalQuantityUsed += qty;
      productMap[pid].totalMaterialCost += materialCost;
      productMap[pid].attributedRevenue += attributedRevenue;
      productMap[pid].usageCount += 1;
    }

    // Calculate profit/loss, margins, averages
    for (const prod of Object.values(productMap)) {
      prod.profitLoss = prod.attributedRevenue - prod.totalMaterialCost;
      prod.profitMargin =
        prod.attributedRevenue > 0
          ? (prod.profitLoss / prod.attributedRevenue) * 100
          : prod.totalMaterialCost > 0
            ? -100
            : 0;
      prod.avgCostPerUse =
        prod.usageCount > 0
          ? prod.totalMaterialCost / prod.usageCount
          : 0;
      prod.avgRevenuePerUse =
        prod.usageCount > 0
          ? prod.attributedRevenue / prod.usageCount
          : 0;
    }

    // Sort by profit/loss descending (most profitable first)
    const productArray = Object.values(productMap).sort(
      (a, b) => b.profitLoss - a.profitLoss
    );

    // Grand totals
    const grandTotalMaterialCost = productArray.reduce(
      (sum, p) => sum + p.totalMaterialCost,
      0
    );
    const grandTotalRevenue = productArray.reduce(
      (sum, p) => sum + p.attributedRevenue,
      0
    );
    const grandTotalProfitLoss = grandTotalRevenue - grandTotalMaterialCost;
    const grandProfitMargin =
      grandTotalRevenue > 0
        ? (grandTotalProfitLoss / grandTotalRevenue) * 100
        : 0;
    const grandTotalUsages = productArray.reduce(
      (sum, p) => sum + p.usageCount,
      0
    );
    const profitableProducts = productArray.filter(
      (p) => p.profitLoss > 0
    ).length;
    const lossProducts = productArray.filter(
      (p) => p.profitLoss < 0
    ).length;

    // 4. Detail records with profit/loss per usage
    const detailedRecords = usageRecords.map((r) => {
      const qty = parseFloat(r.quantityUsed);
      const materialCost = qty * parseFloat(r.pricePerUnit || "0");
      const servicePrice = parseFloat(r.serviceBasePrice || "0");
      const discount = parseFloat(r.discountAmount || "0");
      const netRevenue = Math.max(0, servicePrice - discount);
      const totalMatCostInAppt =
        appointmentTotalMaterialCost[r.appointmentId] || 0;

      let attributedRevenue = 0;
      if (totalMatCostInAppt > 0) {
        attributedRevenue = (materialCost / totalMatCostInAppt) * netRevenue;
      } else if ((appointmentMaterialCounts[r.appointmentId] ?? 0) > 0) {
        attributedRevenue =
          netRevenue / (appointmentMaterialCounts[r.appointmentId] ?? 1);
      }

      return {
        id: r.usageId,
        product: {
          id: r.productId,
          name: r.productName,
          category: r.productCategory,
          unit: r.productUnit,
          pricePerUnit: r.pricePerUnit,
        },
        quantityUsed: r.quantityUsed,
        materialCost: materialCost.toFixed(2),
        attributedRevenue: attributedRevenue.toFixed(2),
        profitLoss: (attributedRevenue - materialCost).toFixed(2),
        date: r.usageDate,
        appointment: {
          id: r.appointmentId,
          date: r.appointmentDate,
          status: r.appointmentStatus,
        },
        employee: r.employeeFirstName
          ? `${r.employeeFirstName} ${r.employeeLastName}`
          : null,
        service: r.serviceName,
      };
    });

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT ZYSKOW I STRAT MATERIALOW");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(
        `Calkowity koszt materialow,${grandTotalMaterialCost.toFixed(2)} PLN`
      );
      csvRows.push(
        `Przypisany przychod,${grandTotalRevenue.toFixed(2)} PLN`
      );
      csvRows.push(
        `Zysk/Strata,${grandTotalProfitLoss.toFixed(2)} PLN`
      );
      csvRows.push(`Marza,${grandProfitMargin.toFixed(1)}%`);
      csvRows.push("");

      csvRows.push("ZYSK/STRATA WG PRODUKTU");
      csvRows.push(
        "Produkt,Kategoria,Zuzycie,Koszt materialow (PLN),Przypisany przychod (PLN),Zysk/Strata (PLN),Marza (%),Liczba uzyc"
      );
      for (const p of productArray) {
        csvRows.push(
          [
            `"${p.productName}"`,
            `"${p.category || "-"}"`,
            `${p.totalQuantityUsed.toFixed(2)} ${p.unit || "szt."}`,
            p.totalMaterialCost.toFixed(2),
            p.attributedRevenue.toFixed(2),
            p.profitLoss.toFixed(2),
            p.profitMargin.toFixed(1),
            p.usageCount,
          ].join(",")
        );
      }
      csvRows.push("");
      csvRows.push(
        `"RAZEM","","",${grandTotalMaterialCost.toFixed(2)},${grandTotalRevenue.toFixed(2)},${grandTotalProfitLoss.toFixed(2)},${grandProfitMargin.toFixed(1)},${grandTotalUsages}`
      );

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-zysk-strata-materialow-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        summary: productArray.map((p) => ({
          productId: p.productId,
          productName: p.productName,
          category: p.category,
          unit: p.unit,
          pricePerUnit: p.pricePerUnit,
          currentStock: p.currentStock,
          totalQuantityUsed: p.totalQuantityUsed,
          totalMaterialCost: p.totalMaterialCost.toFixed(2),
          attributedRevenue: p.attributedRevenue.toFixed(2),
          profitLoss: p.profitLoss.toFixed(2),
          profitMargin: p.profitMargin.toFixed(1),
          usageCount: p.usageCount,
          avgCostPerUse: p.avgCostPerUse.toFixed(2),
          avgRevenuePerUse: p.avgRevenuePerUse.toFixed(2),
        })),
        details: detailedRecords,
        totals: {
          totalMaterialCost: grandTotalMaterialCost.toFixed(2),
          totalRevenue: grandTotalRevenue.toFixed(2),
          totalProfitLoss: grandTotalProfitLoss.toFixed(2),
          profitMargin: grandProfitMargin.toFixed(1),
          totalUsages: grandTotalUsages,
          uniqueProducts: productArray.length,
          profitableProducts,
          lossProducts,
        },
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
      },
    });
  } catch (error) {
    logger.error("[Materials Profit/Loss Report API] Database error", { error: error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate materials profit/loss report",
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointmentMaterials, products, appointments, employees, services } from "@/lib/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/reports/materials - Materials consumption report
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeIdsParam = searchParams.get("employeeIds"); // comma-separated employee IDs
    const format = searchParams.get("format"); // 'json' or 'csv'

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Build conditions for filtering
    const conditions = [eq(products.salonId, salonId)];

    if (dateFrom) {
      conditions.push(gte(appointmentMaterials.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      // End of day for dateTo
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(appointmentMaterials.createdAt, endDate));
    }

    // Employee filter
    const employeeIds = employeeIdsParam
      ? employeeIdsParam.split(",").filter(Boolean)
      : [];
    if (employeeIds.length > 0) {
      conditions.push(inArray(appointments.employeeId, employeeIds));
    }

    // Get all usage records with product and appointment details
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
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
      })
      .from(appointmentMaterials)
      .innerJoin(products, eq(appointmentMaterials.productId, products.id))
      .innerJoin(appointments, eq(appointmentMaterials.appointmentId, appointments.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(...conditions))
      .orderBy(desc(appointmentMaterials.createdAt));

    // Aggregate by product
    const productSummary: Record<
      string,
      {
        productId: string;
        productName: string;
        category: string | null;
        unit: string | null;
        pricePerUnit: string | null;
        currentStock: string | null;
        totalUsed: number;
        totalCost: number;
        usageCount: number;
      }
    > = {};

    for (const record of usageRecords) {
      const pid = record.productId;
      if (!productSummary[pid]) {
        productSummary[pid] = {
          productId: pid,
          productName: record.productName,
          category: record.productCategory,
          unit: record.productUnit,
          pricePerUnit: record.pricePerUnit,
          currentStock: record.currentStock,
          totalUsed: 0,
          totalCost: 0,
          usageCount: 0,
        };
      }
      const qty = parseFloat(record.quantityUsed);
      productSummary[pid].totalUsed += qty;
      productSummary[pid].totalCost +=
        qty * parseFloat(record.pricePerUnit || "0");
      productSummary[pid].usageCount += 1;
    }

    const summaryArray = Object.values(productSummary).sort(
      (a, b) => b.totalCost - a.totalCost
    );

    // Grand totals
    const grandTotalCost = summaryArray.reduce(
      (sum, p) => sum + p.totalCost,
      0
    );
    const grandTotalUsages = summaryArray.reduce(
      (sum, p) => sum + p.usageCount,
      0
    );

    // If CSV export requested
    if (format === "csv") {
      const csvRows: string[] = [];
      // BOM for Excel compatibility
      const BOM = "\uFEFF";

      // Header row
      csvRows.push(
        "Produkt,Kategoria,Jednostka,Zuzycie calkowite,Cena za jednostke (PLN),Koszt calkowity (PLN),Aktualny stan,Liczba uzytkowan"
      );

      for (const p of summaryArray) {
        csvRows.push(
          [
            `"${p.productName}"`,
            `"${p.category || "-"}"`,
            `"${p.unit || "szt."}"`,
            p.totalUsed.toFixed(2),
            parseFloat(p.pricePerUnit || "0").toFixed(2),
            p.totalCost.toFixed(2),
            parseFloat(p.currentStock || "0").toFixed(2),
            p.usageCount,
          ].join(",")
        );
      }

      // Summary row
      csvRows.push("");
      csvRows.push(`"RAZEM","","","","",${grandTotalCost.toFixed(2)},"",${grandTotalUsages}`);

      const csvContent = BOM + csvRows.join("\n");

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-zuzycie-materialow-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // Detailed usage records for the table
    const detailedRecords = usageRecords.map((r) => ({
      id: r.usageId,
      product: {
        id: r.productId,
        name: r.productName,
        category: r.productCategory,
        unit: r.productUnit,
        pricePerUnit: r.pricePerUnit,
      },
      quantityUsed: r.quantityUsed,
      cost: (
        parseFloat(r.quantityUsed) * parseFloat(r.pricePerUnit || "0")
      ).toFixed(2),
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
    }));

    return NextResponse.json({
      success: true,
      data: {
        summary: summaryArray,
        details: detailedRecords,
        totals: {
          totalCost: grandTotalCost.toFixed(2),
          totalUsages: grandTotalUsages,
          uniqueProducts: summaryArray.length,
        },
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
      },
    });
  } catch (error) {
    logger.error("[Materials Report API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to generate materials report" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promotions, promoCodes, appointments, services, clients } from "@/lib/schema";
import { eq, and, gte, lte, desc, sql, isNotNull } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/reports/promotions - Promotion effectiveness report (ROI on promotions)
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

    // 1. Get all promotions for this salon
    const allPromotions = await db
      .select()
      .from(promotions)
      .where(eq(promotions.salonId, salonId))
      .orderBy(desc(promotions.createdAt));

    // 2. Get all promo codes for this salon (linked to promotions)
    const allPromoCodes = await db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.salonId, salonId));

    // Build a map: promoCodeId -> promotionId
    const promoCodeToPromotion: Record<string, string> = {};
    const promoCodeDetails: Record<string, { code: string; usageLimit: number | null; usedCount: number }> = {};
    for (const pc of allPromoCodes) {
      if (pc.promotionId) {
        promoCodeToPromotion[pc.id] = pc.promotionId;
      }
      promoCodeDetails[pc.id] = {
        code: pc.code,
        usageLimit: pc.usageLimit,
        usedCount: pc.usedCount ?? 0,
      };
    }

    // 3. Get appointments that used promo codes within date range
    const conditions: ReturnType<typeof eq>[] = [
      eq(appointments.salonId, salonId),
      isNotNull(appointments.promoCodeId),
    ];

    if (dateFrom) {
      conditions.push(gte(appointments.startTime, new Date(dateFrom)));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(lte(appointments.startTime, endDate));
    }

    const promoAppointments = await db
      .select({
        appointmentId: appointments.id,
        promoCodeId: appointments.promoCodeId,
        discountAmount: appointments.discountAmount,
        startTime: appointments.startTime,
        status: appointments.status,
        serviceId: services.id,
        serviceName: services.name,
        basePrice: services.basePrice,
        clientId: clients.id,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime));

    // 4. Also get appointments WITHOUT promo codes for comparison (completed only)
    const noPromoConditions: ReturnType<typeof eq>[] = [
      eq(appointments.salonId, salonId),
      eq(appointments.status, "completed"),
      sql`${appointments.promoCodeId} IS NULL`,
    ];
    if (dateFrom) {
      noPromoConditions.push(gte(appointments.startTime, new Date(dateFrom)));
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      noPromoConditions.push(lte(appointments.startTime, endDate));
    }

    const noPromoAppointments = await db
      .select({
        basePrice: services.basePrice,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(...noPromoConditions));

    // 5. Aggregate data per promotion
    const promotionStats: Record<
      string,
      {
        promotionId: string;
        promotionName: string;
        promotionType: string;
        promotionValue: string;
        isActive: boolean;
        startDate: Date | null;
        endDate: Date | null;
        totalUsageCount: number;
        completedCount: number;
        cancelledCount: number;
        totalDiscountGiven: number;
        totalRevenueGenerated: number;
        totalBasePriceBeforeDiscount: number;
        uniqueClients: Set<string>;
        promoCodes: string[];
      }
    > = {};

    // Initialize stats for all promotions (even unused ones)
    for (const promo of allPromotions) {
      promotionStats[promo.id] = {
        promotionId: promo.id,
        promotionName: promo.name,
        promotionType: promo.type,
        promotionValue: promo.value,
        isActive: promo.isActive,
        startDate: promo.startDate,
        endDate: promo.endDate,
        totalUsageCount: 0,
        completedCount: 0,
        cancelledCount: 0,
        totalDiscountGiven: 0,
        totalRevenueGenerated: 0,
        totalBasePriceBeforeDiscount: 0,
        uniqueClients: new Set<string>(),
        promoCodes: [],
      };
    }

    // Add promo codes to their promotions
    for (const pc of allPromoCodes) {
      if (pc.promotionId) {
        const promoStat = promotionStats[pc.promotionId];
        if (promoStat) {
          promoStat.promoCodes.push(pc.code);
        }
      }
    }

    // Process appointments
    for (const appt of promoAppointments) {
      const promoCodeId = appt.promoCodeId;
      if (!promoCodeId) continue;

      const promotionId = promoCodeToPromotion[promoCodeId];
      if (!promotionId || !promotionStats[promotionId]) continue;

      const stats = promotionStats[promotionId];
      stats.totalUsageCount += 1;

      const basePrice = parseFloat(appt.basePrice || "0");
      const discount = parseFloat(appt.discountAmount || "0");
      const effectivePrice = Math.max(0, basePrice - discount);

      stats.totalBasePriceBeforeDiscount += basePrice;
      stats.totalDiscountGiven += discount;

      if (appt.status === "completed") {
        stats.completedCount += 1;
        stats.totalRevenueGenerated += effectivePrice;
      } else if (appt.status === "cancelled") {
        stats.cancelledCount += 1;
      }

      if (appt.clientId) {
        stats.uniqueClients.add(appt.clientId);
      }
    }

    // Calculate totals for non-promo appointments
    let totalNoPromoRevenue = 0;
    const totalNoPromoCount = noPromoAppointments.length;
    for (const appt of noPromoAppointments) {
      totalNoPromoRevenue += parseFloat(appt.basePrice || "0");
    }

    // 6. Build response
    const promotionArray = Object.values(promotionStats)
      .map((stats) => {
        const roi =
          stats.totalDiscountGiven > 0
            ? ((stats.totalRevenueGenerated - stats.totalDiscountGiven) /
                stats.totalDiscountGiven) *
              100
            : stats.totalRevenueGenerated > 0
            ? 100
            : 0;

        const conversionRate =
          stats.totalUsageCount > 0
            ? (stats.completedCount / stats.totalUsageCount) * 100
            : 0;

        return {
          promotionId: stats.promotionId,
          promotionName: stats.promotionName,
          promotionType: stats.promotionType,
          promotionValue: stats.promotionValue,
          isActive: stats.isActive,
          startDate: stats.startDate?.toISOString() || null,
          endDate: stats.endDate?.toISOString() || null,
          totalUsageCount: stats.totalUsageCount,
          completedCount: stats.completedCount,
          cancelledCount: stats.cancelledCount,
          totalDiscountGiven: stats.totalDiscountGiven.toFixed(2),
          totalRevenueGenerated: stats.totalRevenueGenerated.toFixed(2),
          totalBasePriceBeforeDiscount:
            stats.totalBasePriceBeforeDiscount.toFixed(2),
          uniqueClients: stats.uniqueClients.size,
          promoCodes: stats.promoCodes,
          roi: roi.toFixed(1),
          conversionRate: conversionRate.toFixed(1),
        };
      })
      .sort((a, b) => b.totalUsageCount - a.totalUsageCount);

    // Summary statistics
    const totalDiscountGiven = promotionArray.reduce(
      (sum, p) => sum + parseFloat(p.totalDiscountGiven),
      0
    );
    const totalRevenueFromPromos = promotionArray.reduce(
      (sum, p) => sum + parseFloat(p.totalRevenueGenerated),
      0
    );
    const totalPromoUsage = promotionArray.reduce(
      (sum, p) => sum + p.totalUsageCount,
      0
    );
    const totalCompletedWithPromo = promotionArray.reduce(
      (sum, p) => sum + p.completedCount,
      0
    );
    const totalActivePromotions = promotionArray.filter(
      (p) => p.isActive
    ).length;
    const avgNoPromoPrice =
      totalNoPromoCount > 0 ? totalNoPromoRevenue / totalNoPromoCount : 0;

    const overallROI =
      totalDiscountGiven > 0
        ? ((totalRevenueFromPromos - totalDiscountGiven) / totalDiscountGiven) *
          100
        : totalRevenueFromPromos > 0
        ? 100
        : 0;

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      csvRows.push("RAPORT EFEKTYWNOSCI PROMOCJI");
      csvRows.push(
        `Okres,${dateFrom || "poczatek"},-,${dateTo || "koniec"}`
      );
      csvRows.push(`Laczna kwota znizek,${totalDiscountGiven.toFixed(2)} PLN`);
      csvRows.push(
        `Przychod z promocji,${totalRevenueFromPromos.toFixed(2)} PLN`
      );
      csvRows.push(`Laczne uzycie promocji,${totalPromoUsage}`);
      csvRows.push(
        `Ukonczone wizyty z promocja,${totalCompletedWithPromo}`
      );
      csvRows.push(`ROI,${overallROI.toFixed(1)}%`);
      csvRows.push("");

      csvRows.push("SZCZEGOLY WG PROMOCJI");
      csvRows.push(
        "Nazwa,Typ,Wartosc,Status,Uzycie,Ukonczone,Anulowane,Znizka (PLN),Przychod (PLN),ROI (%),Klienci,Kody"
      );

      for (const p of promotionArray) {
        csvRows.push(
          `"${p.promotionName}","${p.promotionType}","${p.promotionValue}","${
            p.isActive ? "Aktywna" : "Nieaktywna"
          }",${p.totalUsageCount},${p.completedCount},${p.cancelledCount},${
            p.totalDiscountGiven
          },${p.totalRevenueGenerated},${p.roi},${
            p.uniqueClients
          },"${p.promoCodes.join(", ")}"`
        );
      }
      csvRows.push("");

      // Totals
      csvRows.push(
        `"RAZEM","","","",${totalPromoUsage},${totalCompletedWithPromo},"",${totalDiscountGiven.toFixed(
          2
        )},${totalRevenueFromPromos.toFixed(2)},${overallROI.toFixed(1)},"",""`
      );

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-promocji-${
            dateFrom || "all"
          }-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalPromotions: allPromotions.length,
          activePromotions: totalActivePromotions,
          totalPromoUsage,
          totalCompletedWithPromo,
          totalDiscountGiven: totalDiscountGiven.toFixed(2),
          totalRevenueFromPromos: totalRevenueFromPromos.toFixed(2),
          overallROI: overallROI.toFixed(1),
          avgNoPromoPrice: avgNoPromoPrice.toFixed(2),
          totalNoPromoAppointments: totalNoPromoCount,
        },
        promotions: promotionArray,
        filters: {
          salonId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        },
      },
    });
  } catch (error) {
    logger.error("[Promotions Report API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to generate promotions report" },
      { status: 500 }
    );
  }
}

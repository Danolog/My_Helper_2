import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  treatmentHistory,
  employeeCommissions,
  employees,
  services,
  employeeServicePrices,
  serviceProducts,
  products,
  productUsage,
  notifications,
  loyaltyPoints,
  loyaltyTransactions,
  salons,
} from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import type { LoyaltySettings } from "@/app/api/salons/[id]/loyalty-settings/route";
import { DEFAULT_COMMISSION_RATE } from "@/lib/constants";
import { validateBody, completeAppointmentSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";

/**
 * Database query executor — works for both the top-level `db` instance
 * and the `tx` parameter inside a `db.transaction()` callback.
 * Extracts the transaction type from drizzle's own `db.transaction` signature.
 */
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Check if a product has low stock and create a notification if needed.
 * Prevents duplicate notifications within 24 hours.
 * Accepts a `tx` executor so it can participate in a surrounding transaction.
 */
async function checkAndNotifyLowStock(
  tx: DbExecutor,
  product: {
    id: string;
    salonId: string;
    name: string;
    quantity: string | null;
    minQuantity: string | null;
    unit: string | null;
  }
) {
  const qty = parseFloat(product.quantity || "0");
  const minQty = product.minQuantity ? parseFloat(product.minQuantity) : null;

  if (minQty === null) return null;

  if (qty <= minQty) {
    // Check for existing notification in the last 24h to avoid duplicates
    const existingRecent = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.salonId, product.salonId),
          sql`${notifications.message} LIKE ${"%" + product.id + "%"}`,
          sql`${notifications.createdAt} > NOW() - INTERVAL '24 hours'`,
          sql`${notifications.type} = 'system'`
        )
      )
      .limit(1);

    if (existingRecent.length > 0) {
      return { notificationSent: false, reason: "duplicate" };
    }

    const unitLabel = product.unit || "szt.";
    const message = `Niski stan magazynowy: "${product.name}" - pozostalo ${qty} ${unitLabel} (minimum: ${minQty} ${unitLabel}). Uzupelnij zapasy! [product:${product.id}]`;

    const [notification] = await tx
      .insert(notifications)
      .values({
        salonId: product.salonId,
        type: "system",
        message,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    logger.info("Low stock alert notification sent", {
      productName: product.name,
      productId: product.id,
      currentQty: qty,
      minQty,
    });

    return { notificationSent: true, notification };
  }

  return { notificationSent: false, reason: "stock_ok" };
}

// POST /api/appointments/[id]/complete - Complete an appointment with treatment notes and commission
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(completeAppointmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { recipe, techniques, notes, commissionPercentage } = body;

    // Fetch the appointment with service info
    const result = await db
      .select({
        appointment: appointments,
        service: services,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(eq(appointments.id, id))
      .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    const appointment = row.appointment;
    const service = row.service;

    // Don't allow completing already completed or cancelled appointments
    if (appointment.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz zakonczona" },
        { status: 400 }
      );
    }
    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Nie mozna zakonczyc anulowanej wizyty" },
        { status: 400 }
      );
    }

    // All mutating operations are wrapped in a single transaction so that
    // a failure at any step (e.g. stock deduction, commission insert) rolls
    // back every preceding write, keeping the database consistent.
    const txResult = await db.transaction(async (tx) => {
      // 1. Save or update treatment record
      const [existingTreatment] = await tx
        .select()
        .from(treatmentHistory)
        .where(eq(treatmentHistory.appointmentId, id))
        .limit(1);

      let treatment;
      if (existingTreatment) {
        const updateData: Record<string, unknown> = {};
        if (recipe !== undefined) updateData.recipe = recipe;
        if (techniques !== undefined) updateData.techniques = techniques;
        if (notes !== undefined) updateData.notes = notes;

        [treatment] = await tx
          .update(treatmentHistory)
          .set(updateData)
          .where(eq(treatmentHistory.id, existingTreatment.id))
          .returning();
      } else {
        [treatment] = await tx
          .insert(treatmentHistory)
          .values({
            appointmentId: id,
            recipe: recipe || null,
            techniques: techniques || null,
            materialsJson: [],
            notes: notes || null,
          })
          .returning();
      }

      logger.info("Treatment record saved", {
        action: existingTreatment ? "updated" : "created",
        appointmentId: id,
      });

      // 2. Mark appointment as completed
      const [updatedAppointment] = await tx
        .update(appointments)
        .set({ status: "completed" })
        .where(eq(appointments.id, id))
        .returning();

      logger.info("Appointment marked as completed", { appointmentId: id });

      // 3. Calculate and record commission
      let commission = null;

      // Determine commission percentage: use provided value, or employee's default, or fallback
      let commPct = DEFAULT_COMMISSION_RATE;
      if (commissionPercentage !== undefined && commissionPercentage !== null) {
        commPct = parseFloat(commissionPercentage);
      } else if (appointment.employeeId) {
        // Look up employee's default commission rate
        const [emp] = await tx
          .select({ commissionRate: employees.commissionRate })
          .from(employees)
          .where(eq(employees.id, appointment.employeeId))
          .limit(1);
        if (emp?.commissionRate) {
          commPct = parseFloat(emp.commissionRate);
        }
      }

      if (service && appointment.employeeId) {
        // Determine effective service price
        // Check for employee-specific pricing first
        let effectivePrice = parseFloat(service.basePrice);

        const [employeePrice] = await tx
          .select()
          .from(employeeServicePrices)
          .where(
            and(
              eq(employeeServicePrices.employeeId, appointment.employeeId),
              eq(employeeServicePrices.serviceId, service.id)
            )
          )
          .limit(1);

        if (employeePrice) {
          effectivePrice = parseFloat(employeePrice.customPrice);
        }

        const commissionAmount = (effectivePrice * commPct) / 100;

        // Check if commission already exists for this appointment
        const [existingCommission] = await tx
          .select()
          .from(employeeCommissions)
          .where(eq(employeeCommissions.appointmentId, id))
          .limit(1);

        if (existingCommission) {
          // Update existing commission
          [commission] = await tx
            .update(employeeCommissions)
            .set({
              amount: commissionAmount.toFixed(2),
              percentage: commPct.toFixed(2),
            })
            .where(eq(employeeCommissions.id, existingCommission.id))
            .returning();
        } else {
          // Create new commission record
          [commission] = await tx
            .insert(employeeCommissions)
            .values({
              employeeId: appointment.employeeId,
              appointmentId: id,
              amount: commissionAmount.toFixed(2),
              percentage: commPct.toFixed(2),
            })
            .returning();
        }

        logger.info("Commission recorded", {
          commissionPct: commPct,
          effectivePrice: effectivePrice.toFixed(2),
          commissionAmount: commissionAmount.toFixed(2),
          employeeId: appointment.employeeId,
        });
      }

      // 4. Automatic stock deduction - deduct linked products from inventory
      const stockDeductions: Array<{
        productId: string;
        productName: string;
        quantityDeducted: number;
        newQuantity: number;
        unit: string | null;
        lowStockAlert: { notificationSent: boolean; reason?: string } | null;
      }> = [];

      if (service) {
        // Find all products linked to this service
        const linkedProducts = await tx
          .select({
            linkId: serviceProducts.id,
            productId: serviceProducts.productId,
            defaultQuantity: serviceProducts.defaultQuantity,
            productName: products.name,
            productQuantity: products.quantity,
            productUnit: products.unit,
            productMinQuantity: products.minQuantity,
            productSalonId: products.salonId,
          })
          .from(serviceProducts)
          .leftJoin(products, eq(serviceProducts.productId, products.id))
          .where(eq(serviceProducts.serviceId, service.id));

        for (const linked of linkedProducts) {
          if (!linked.productName || !linked.productSalonId) continue; // Skip if product was deleted

          const qtyToDeduct = parseFloat(linked.defaultQuantity || "1");
          const currentQty = parseFloat(linked.productQuantity || "0");
          const newQty = Math.max(0, currentQty - qtyToDeduct);

          // Deduct stock
          await tx
            .update(products)
            .set({ quantity: newQty.toString() })
            .where(eq(products.id, linked.productId));

          // Record usage in productUsage table
          await tx
            .insert(productUsage)
            .values({
              productId: linked.productId,
              appointmentId: id,
              quantity: qtyToDeduct.toString(),
            });

          logger.info("Stock deducted", {
            productName: linked.productName,
            quantityDeducted: qtyToDeduct,
            unit: linked.productUnit || "szt.",
            previousQty: currentQty,
            newQty,
          });

          // Check for low stock and notify
          let lowStockAlert = null;
          try {
            lowStockAlert = await checkAndNotifyLowStock(tx, {
              id: linked.productId,
              salonId: linked.productSalonId,
              name: linked.productName,
              quantity: newQty.toString(),
              minQuantity: linked.productMinQuantity,
              unit: linked.productUnit,
            });
          } catch (alertError) {
            logger.error("Low stock check failed (non-blocking)", { error: alertError });
          }

          stockDeductions.push({
            productId: linked.productId,
            productName: linked.productName,
            quantityDeducted: qtyToDeduct,
            newQuantity: newQty,
            unit: linked.productUnit,
            lowStockAlert,
          });
        }

        if (stockDeductions.length > 0) {
          logger.info("Auto-deducted products for service", {
            productsCount: stockDeductions.length,
            serviceName: service.name,
          });
        }
      }

      // 5. Award loyalty points if loyalty program is enabled
      let loyaltyResult: {
        pointsAwarded: number;
        totalPoints: number;
        loyaltyId: string;
        transactionId: string;
      } | null = null;

      if (appointment.clientId && service) {
        try {
          // Fetch salon loyalty settings
          const [salon] = await tx
            .select({ id: salons.id, settingsJson: salons.settingsJson })
            .from(salons)
            .where(eq(salons.id, appointment.salonId))
            .limit(1);

          if (salon) {
            const settings = salon.settingsJson as Record<string, unknown> | null;
            const loyaltySettings = settings?.loyalty as LoyaltySettings | undefined;

            if (loyaltySettings?.enabled) {
              // Calculate effective price for points
              let priceForPoints = parseFloat(service.basePrice);

              // Check for employee-specific pricing
              if (appointment.employeeId) {
                const [empPrice] = await tx
                  .select()
                  .from(employeeServicePrices)
                  .where(
                    and(
                      eq(employeeServicePrices.employeeId, appointment.employeeId),
                      eq(employeeServicePrices.serviceId, service.id)
                    )
                  )
                  .limit(1);

                if (empPrice) {
                  priceForPoints = parseFloat(empPrice.customPrice);
                }
              }

              // Apply discount if any
              if (appointment.discountAmount) {
                priceForPoints = Math.max(0, priceForPoints - parseFloat(appointment.discountAmount));
              }

              // Calculate points: (price / currencyUnit) * pointsPerCurrencyUnit
              const currencyUnit = loyaltySettings.currencyUnit || 1;
              const pointsPerUnit = loyaltySettings.pointsPerCurrencyUnit || 1;
              const pointsToAward = Math.floor((priceForPoints / currencyUnit) * pointsPerUnit);

              if (pointsToAward > 0) {
                // Get or create loyalty points record for this client+salon
                const existingRecords = await tx
                  .select()
                  .from(loyaltyPoints)
                  .where(
                    and(
                      eq(loyaltyPoints.clientId, appointment.clientId),
                      eq(loyaltyPoints.salonId, appointment.salonId)
                    )
                  )
                  .limit(1);

                let loyaltyRecord = existingRecords[0];

                if (!loyaltyRecord) {
                  // Create new loyalty record
                  const created = await tx
                    .insert(loyaltyPoints)
                    .values({
                      clientId: appointment.clientId,
                      salonId: appointment.salonId,
                      points: 0,
                    })
                    .returning();
                  loyaltyRecord = created[0];
                }

                if (!loyaltyRecord) {
                  throw new Error("Failed to create or fetch loyalty record");
                }

                // Update points balance
                const newBalance = loyaltyRecord.points + pointsToAward;
                await tx
                  .update(loyaltyPoints)
                  .set({
                    points: newBalance,
                    lastUpdated: new Date(),
                  })
                  .where(eq(loyaltyPoints.id, loyaltyRecord.id));

                // Log the transaction
                const transactionResult = await tx
                  .insert(loyaltyTransactions)
                  .values({
                    loyaltyId: loyaltyRecord.id,
                    pointsChange: pointsToAward,
                    reason: `Wizyta: ${service.name} (${priceForPoints.toFixed(2)} PLN)`,
                    appointmentId: id,
                  })
                  .returning();

                const transaction = transactionResult[0];
                if (!transaction) {
                  throw new Error("Failed to create loyalty transaction");
                }

                loyaltyResult = {
                  pointsAwarded: pointsToAward,
                  totalPoints: newBalance,
                  loyaltyId: loyaltyRecord.id,
                  transactionId: transaction.id,
                };

                logger.info("Loyalty points awarded", {
                  pointsAwarded: pointsToAward,
                  servicePrice: priceForPoints.toFixed(2),
                  newBalance,
                  clientId: appointment.clientId,
                });
              }
            }
          }
        } catch (loyaltyError) {
          logger.error("Loyalty points error (non-blocking)", { error: loyaltyError });
        }
      }

      return {
        appointment: updatedAppointment,
        treatment,
        commission,
        stockDeductions,
        loyalty: loyaltyResult,
      };
    });

    return NextResponse.json({
      success: true,
      data: txResult,
      message: "Wizyta zakonczona pomyslnie",
    });
  } catch (error) {
    logger.error("Failed to complete appointment", { error });
    return NextResponse.json(
      { success: false, error: "Failed to complete appointment" },
      { status: 500 }
    );
  }
}

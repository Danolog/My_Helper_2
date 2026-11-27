import { NextResponse } from "next/server";
import { eq, and, like, notInArray, sql } from "drizzle-orm";
import type { LoyaltySettings } from "@/app/api/salons/[id]/loyalty-settings/route";
import { parseBody, completeAppointmentSchema } from "@/lib/api-validation";
import {
  APPOINTMENT_COMPLETED_CODE,
  APPOINTMENT_COMPLETED_MESSAGE,
  COMMISSION_RATE_INVALID_MESSAGE,
  COMPLETE_ERROR_CODES,
  SERVICE_PRICE_INVALID_MESSAGE,
  commissionFor,
} from "@/lib/appointment-completion";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { DEFAULT_COMMISSION_RATE } from "@/lib/constants";
import { resolveModules } from "@/lib/features";
import { logger } from "@/lib/logger";
import {
  NO_SHOW_COMPLETE_BLOCKED_CODE,
  NO_SHOW_COMPLETE_BLOCKED_MESSAGE,
  NO_SHOW_STATUS,
} from "@/lib/no-show";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import {
  appointments,
  treatmentHistory,
  employeeCommissions,
  employees,
  services,
  employeeServicePrices,
  serviceProducts,
  products,
  appointmentMaterials,
  notifications,
  loyaltyPoints,
  loyaltyTransactions,
  salons,
} from "@/lib/schema";
import { forSalon, type DbTx } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * Statusy, których nie da się zakończyć. Zakończona — 409 jak w PUT i DELETE,
 * anulowana — 400 jak „już anulowana” w DELETE, „Nie przyszedł” — 409
 * (najpierw cofnięcie).
 */
const NOT_COMPLETABLE_STATUSES = ["completed", "cancelled", NO_SHOW_STATUS];

/**
 * Wizyty nie da się zakończyć: odczyt pod blokadą wiersza nie znalazł wizyty
 * (albo pracownik kończy cudzą), wizyta ma status spoza dozwolonych, albo
 * zapis statusu nie trafił w wiersz. Rzucany w transakcji, żeby wycofać
 * wszystkie jej zapisy. `currentStatus` to status z tej samej transakcji
 * (`null` = brak wizyty dla wołającego) — od niego zależy odpowiedź.
 */
class AppointmentNotCompletableError extends Error {
  readonly currentStatus: string | null;

  constructor(currentStatus: string | null) {
    super("Appointment cannot be completed");
    this.name = "AppointmentNotCompletableError";
    this.currentStatus = currentStatus;
  }
}

/**
 * Dane w bazie nie pozwalają policzyć prowizji (cena albo stawka nie jest
 * liczbą skończoną, np. 'NaN' w kolumnie numeric). Rzucany w transakcji:
 * nic się nie zapisuje, trasa oddaje 409 z kodem zamiast prowizji „NaN”.
 */
class CompletionDataError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string) {
    super("Appointment completion data invalid");
    this.name = "CompletionDataError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, code, error }, { status });
}

/**
 * Nazwa ograniczenia z błędu sterownika, także opakowanego w `cause` przez
 * Drizzle (postgres.js podaje ją w `constraint_name`, node-postgres w `constraint`).
 * Sama nazwa, bez wartości — bezpieczna do logu.
 */
function dbConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const e = current as { constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const name = e.constraint_name ?? e.constraint;
    if (typeof name === "string") return name;
    current = e.cause;
  }
  return undefined;
}

function noShowConflictResponse() {
  return errorResponse(409, NO_SHOW_COMPLETE_BLOCKED_CODE, NO_SHOW_COMPLETE_BLOCKED_MESSAGE);
}

function appointmentNotFoundResponse() {
  return errorResponse(404, COMPLETE_ERROR_CODES.appointmentNotFound, "Appointment not found");
}

/**
 * Odpowiedź dla wizyty, której nie da się zakończyć — wspólna dla
 * sprawdzenia pod blokadą wiersza i dla zapisu, który nie trafił w wiersz.
 * `null` dla statusu spoza listy (nie powinien wystąpić: UPDATE odrzuca
 * tylko te statusy).
 */
function notCompletableResponse(status: string): NextResponse | null {
  if (status === "completed") {
    return errorResponse(409, APPOINTMENT_COMPLETED_CODE, APPOINTMENT_COMPLETED_MESSAGE);
  }
  if (status === "cancelled") {
    return errorResponse(
      400,
      COMPLETE_ERROR_CODES.appointmentCancelled,
      "Nie mozna zakonczyc anulowanej wizyty"
    );
  }
  if (status === NO_SHOW_STATUS) {
    return noShowConflictResponse();
  }
  return null;
}

/**
 * Check if a product has low stock and create a notification if needed.
 * Prevents duplicate notifications within 24 hours.
 * Accepts a `tx` executor so it can participate in a surrounding transaction.
 */
async function checkAndNotifyLowStock(
  tx: DbTx,
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
          like(notifications.message, `%${product.id}%`),
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

    // Log dopiero po zatwierdzeniu transakcji (w trasie), nie tutaj.
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

    // Faza 3 (role): owner/receptionist domykają dowolną wizytę salonu,
    // employee wyłącznie własną (sprawdzenie po pobraniu wizyty niżej).
    const ctx = await getSalonContext();
    if (!ctx) {
      return errorResponse(404, COMPLETE_ERROR_CODES.salonNotFound, "Salon not found");
    }
    const salonId = ctx.salonId;

    const { id } = await params;
    // Niepoprawny identyfikator dawał błąd bazy (22P02) i 500.
    if (!isValidUuid(id)) {
      return errorResponse(400, COMPLETE_ERROR_CODES.invalidId, "Invalid appointment ID format");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, COMPLETE_ERROR_CODES.invalidJson, "Invalid JSON body");
    }

    // Server-side validation with Zod schema. Sparsowane dane, nie surowe body:
    // schemat zamienia kwotę na tekst dla kolumny numeric.
    const parsed = parseBody(completeAppointmentSchema, body);
    if (!parsed.ok) {
      return NextResponse.json(
        { ...parsed.error, code: COMPLETE_ERROR_CODES.validationFailed },
        { status: 400 }
      );
    }

    const { recipe, techniques, notes, commissionPercentage, paidAmount, paymentMethod } =
      parsed.data;
    // Para (oba albo żadne) sprawdzona w schemacie. Brak = bez zapisu płatności:
    // pola nie trafiają do SET, więc istniejąca wartość kolumn zostaje.
    const payment =
      paidAmount != null && paymentMethod != null ? { paidAmount, paymentMethod } : {};

    // All mutating operations are wrapped in a single transaction so that
    // a failure at any step (e.g. stock deduction, commission insert) rolls
    // back every preceding write, keeping the database consistent.
    // Kontekst RLS salonu z sesji (#193): tabele pośrednie (treatment_history,
    // appointment_materials, employee_commissions, loyalty_transactions) i
    // `salons` (polityka `tenant_self`) widzą tylko ten salon; jawne filtry zostają.
    const txResult = await forSalon(salonId).raw(async (tx) => {
      // 0. Wizyta z usługą pod blokadą wiersza wizyty — pierwsza instrukcja
      // transakcji i jedyny odczyt wizyty. Status, pracownik, usługa, klient
      // i rabat do końca transakcji są takie, jak tutaj: równoległe
      // przeniesienie, anulowanie, „Nie przyszedł” albo drugie zakończenie
      // czeka na COMMIT albo jest już zatwierdzone i widoczne w tym odczycie.
      // Prowizja, cena, zużycie i punkty liczą się z tego odczytu.
      const [row] = await tx
        .select({
          appointment: appointments,
          service: services,
        })
        .from(appointments)
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .limit(1)
        .for("update", { of: appointments });

      // Employee: cudza wizyta = 404 (nie 403 — nie zdradzamy istnienia).
      // Sprawdzane pod blokadą: wizyta przepisana na innego pracownika
      // w tej chwili nie jest już jego.
      if (
        !row ||
        (ctx.role === "employee" &&
          (!ctx.employeeId || row.appointment.employeeId !== ctx.employeeId))
      ) {
        throw new AppointmentNotCompletableError(null);
      }

      const appointment = row.appointment;
      const service = row.service;

      // Wizyta zakończona, anulowana albo „Nie przyszedł” — przed zapisami.
      if (NOT_COMPLETABLE_STATUSES.includes(appointment.status)) {
        throw new AppointmentNotCompletableError(appointment.status);
      }

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
      // Warunek statusu w samym UPDATE i ponowny odczyt przy 0 wierszach to
      // druga linia obrony: pod blokadą z kroku 0 status nie może się zmienić,
      // ale zapis nie polega wyłącznie na tym, że blokada została wzięta.
      // Kwota i metoda płatności w tym samym SET co status: zapisują się tylko
      // razem z zakończeniem i wycofują razem z resztą transakcji. Nie logujemy ich.
      const [updatedAppointment] = await tx
        .update(appointments)
        .set({ status: "completed", ...payment })
        .where(
          and(
            eq(appointments.id, id),
            eq(appointments.salonId, salonId),
            notInArray(appointments.status, NOT_COMPLETABLE_STATUSES)
          )
        )
        .returning();
      if (!updatedAppointment) {
        // Bieżący status z tej samej transakcji: w READ COMMITTED kolejne
        // zapytanie widzi zmianę zatwierdzoną przez równoległą transakcję,
        // więc odpowiedź mówi, co faktycznie stało się z wizytą.
        const [current] = await tx
          .select({ status: appointments.status })
          .from(appointments)
          .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
          .limit(1);
        throw new AppointmentNotCompletableError(current?.status ?? null);
      }

      // 3. Calculate and record commission
      let commission = null;

      // Determine commission percentage: use provided value, or employee's default, or fallback
      let commPct = DEFAULT_COMMISSION_RATE;
      if (commissionPercentage !== undefined && commissionPercentage !== null) {
        // Schemat zwraca liczbę skończoną z zakresu 0–100.
        commPct = commissionPercentage;
      } else if (appointment.employeeId) {
        // Look up employee's default commission rate
        const [emp] = await tx
          .select({ commissionRate: employees.commissionRate })
          .from(employees)
          .where(and(eq(employees.id, appointment.employeeId), eq(employees.salonId, salonId)))
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

        // 'NaN' albo 'Infinity' w kolumnie numeric dałyby prowizję „NaN”
        // albo 500 z bazy. Błąd z kodem wycofuje całą transakcję.
        if (!Number.isFinite(effectivePrice)) {
          throw new CompletionDataError(
            COMPLETE_ERROR_CODES.servicePriceInvalid,
            SERVICE_PRICE_INVALID_MESSAGE
          );
        }
        if (!Number.isFinite(commPct)) {
          throw new CompletionDataError(
            COMPLETE_ERROR_CODES.commissionRateInvalid,
            COMMISSION_RATE_INVALID_MESSAGE
          );
        }

        const { amount: commissionAmount, percentage: commissionPercentageSaved } =
          commissionFor(effectivePrice, commPct);

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
              amount: commissionAmount,
              percentage: commissionPercentageSaved,
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
              amount: commissionAmount,
              percentage: commissionPercentageSaved,
            })
            .returning();
        }

        logger.info("Commission recorded", {
          commissionPct: commissionPercentageSaved,
          effectivePrice: effectivePrice.toFixed(2),
          commissionAmount,
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
            .where(and(eq(products.id, linked.productId), eq(products.salonId, salonId)));

          // Zapis zuzycia do appointmentMaterials — tabeli, ktora czytaja
          // raporty materialow/rentownosci (UAT S-2). Wczesniej pisalismy do
          // productUsage, ktorej zaden raport nie czyta, wiec koszt auto-
          // zuzytych materialow byl niewidoczny w sprawozdawczosci.
          await tx
            .insert(appointmentMaterials)
            .values({
              appointmentId: id,
              productId: linked.productId,
              quantityUsed: qtyToDeduct.toString(),
              notes: "Automatyczne zuzycie (usluga)",
            });

          logger.info("Stock deducted", {
            productName: linked.productName,
            quantityDeducted: qtyToDeduct,
            unit: linked.productUnit || "szt.",
            previousQty: currentQty,
            newQty,
          });

          // Check for low stock and notify. Najlepszy wysiłek w zagnieżdżonej
          // transakcji (savepoint): błąd bazy cofa tylko powiadomienie. Bez
          // savepointu Postgres oznacza całą transakcję jako przerwaną, COMMIT
          // ją wycofuje, a trasa oddałaby 200 z zakończeniem, którego nie ma.
          const stockProduct = {
            id: linked.productId,
            salonId: linked.productSalonId,
            name: linked.productName,
            quantity: newQty.toString(),
            minQuantity: linked.productMinQuantity,
            unit: linked.productUnit,
          };
          let lowStockAlert = null;
          try {
            lowStockAlert = await tx.transaction((sp) => checkAndNotifyLowStock(sp, stockProduct));
          } catch (alertError) {
            logger.error("Low stock check failed (non-blocking)", { ...toErrorIdentity(alertError) });
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

      // 5. Award loyalty points if the loyalty module is on (registry in
      // src/lib/features.ts — frozen modules are always off) AND the salon
      // enabled the program in its loyalty settings.
      let loyaltyResult: {
        pointsAwarded: number;
        totalPoints: number;
        loyaltyId: string;
        transactionId: string;
      } | null = null;

      if (appointment.clientId && service) {
        const loyaltyClientId = appointment.clientId;
        // Najlepszy wysiłek w zagnieżdżonej transakcji (savepoint), jak alert
        // niskiego stanu: błąd cofa tylko punkty, zakończenie wizyty zostaje.
        const loyaltyEmployeeId = appointment.employeeId;
        try {
          loyaltyResult = await tx.transaction(async (sp) => {
            // Fetch salon loyalty settings
            const [salon] = await sp
              .select({ id: salons.id, settingsJson: salons.settingsJson })
              .from(salons)
              .where(eq(salons.id, salonId))
              .limit(1);

            if (!salon) return null;
            const settings = salon.settingsJson as Record<string, unknown> | null;
            const loyaltySettings = settings?.loyalty as LoyaltySettings | undefined;

            if (!resolveModules(settings).loyalty || !loyaltySettings?.enabled) return null;

            // Calculate effective price for points
            let priceForPoints = parseFloat(service.basePrice);

            // Check for employee-specific pricing
            if (loyaltyEmployeeId) {
              const [empPrice] = await sp
                .select()
                .from(employeeServicePrices)
                .where(
                  and(
                    eq(employeeServicePrices.employeeId, loyaltyEmployeeId),
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

            // Cena spoza liczb skończonych ('NaN' w numeric) — bez punktów.
            if (!Number.isFinite(priceForPoints)) return null;

            // Calculate points: (price / currencyUnit) * pointsPerCurrencyUnit
            const currencyUnit = loyaltySettings.currencyUnit || 1;
            const pointsPerUnit = loyaltySettings.pointsPerCurrencyUnit || 1;
            const pointsToAward = Math.floor((priceForPoints / currencyUnit) * pointsPerUnit);

            if (pointsToAward <= 0) return null;

            // Get or create loyalty points record for this client+salon
            const existingRecords = await sp
              .select()
              .from(loyaltyPoints)
              .where(
                and(
                  eq(loyaltyPoints.clientId, loyaltyClientId),
                  eq(loyaltyPoints.salonId, appointment.salonId)
                )
              )
              .limit(1);

            let loyaltyRecord = existingRecords[0];

            if (!loyaltyRecord) {
              // Create new loyalty record
              const created = await sp
                .insert(loyaltyPoints)
                .values({
                  clientId: loyaltyClientId,
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
            await sp
              .update(loyaltyPoints)
              .set({
                points: newBalance,
                lastUpdated: new Date(),
              })
              .where(eq(loyaltyPoints.id, loyaltyRecord.id));

            // Log the transaction
            const transactionResult = await sp
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

            // Log dopiero po zatwierdzeniu transakcji (w trasie), bez klienta i kwot.
            return {
              pointsAwarded: pointsToAward,
              totalPoints: newBalance,
              loyaltyId: loyaltyRecord.id,
              transactionId: transaction.id,
            };
          });
        } catch (loyaltyError) {
          // Sama tożsamość błędu: treść błędu zapytania niesie SQL i parametry.
          logger.error("Loyalty points error (non-blocking)", { ...toErrorIdentity(loyaltyError) });
        }
      }

      return {
        appointment: updatedAppointment,
        // Wartości zapisane w bazie (z RETURNING), nie echo żądania.
        payment: {
          paidAmount: updatedAppointment.paidAmount ?? null,
          paymentMethod: updatedAppointment.paymentMethod ?? null,
        },
        treatment,
        commission,
        stockDeductions,
        loyalty: loyaltyResult,
      };
    });

    // Po zatwierdzeniu transakcji: log nie twierdzi zakończenia, które COMMIT wycofał.
    logger.info("Appointment marked as completed", { appointmentId: id });
    for (const deduction of txResult.stockDeductions) {
      if (deduction.lowStockAlert?.notificationSent) {
        logger.info("Low stock alert notification sent", {
          appointmentId: id,
          productId: deduction.productId,
        });
      }
    }
    if (txResult.loyalty) {
      logger.info("Loyalty points awarded", {
        appointmentId: id,
        pointsAwarded: txResult.loyalty.pointsAwarded,
      });
    }

    return NextResponse.json({
      success: true,
      data: txResult,
      message: "Wizyta zakonczona pomyslnie",
    });
  } catch (error) {
    if (error instanceof AppointmentNotCompletableError) {
      // Wiersz zniknął po odczycie → 404; status spoza listy (nie powinien
      // wystąpić) → 409 jak dotąd, bo zakończenie i tak nie zostało zapisane.
      if (error.currentStatus === null) return appointmentNotFoundResponse();
      return notCompletableResponse(error.currentStatus) ?? noShowConflictResponse();
    }
    if (error instanceof CompletionDataError) {
      // Sam kod, bez ceny i stawki.
      logger.warn("Appointment completion blocked by invalid data", { code: error.code });
      return errorResponse(409, error.code, error.userMessage);
    }
    // Bez `message` i `stack`: treść błędu zapytania niesie SQL i parametry
    // (m.in. kwotę i metodę płatności). Tylko nazwa, SQLSTATE i ograniczenie.
    const constraint = dbConstraintName(error);
    logger.error("Failed to complete appointment", {
      ...toErrorIdentity(error),
      ...(constraint ? { constraint } : {}),
    });
    return NextResponse.json(
      { success: false, error: "Failed to complete appointment" },
      { status: 500 }
    );
  }
}

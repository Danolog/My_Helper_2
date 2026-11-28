import { NextResponse } from "next/server";
import { eq, and, like, notInArray, sql } from "drizzle-orm";
import type { LoyaltySettings } from "@/app/api/salons/[id]/loyalty-settings/route";
import { parseBody, completeAppointmentSchema } from "@/lib/api-validation";
import {
  APPOINTMENT_COMPLETED_CODE,
  COMPLETE_ERROR_CODES,
  COMPLETE_MESSAGES,
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
import { getSalonContext, type SalonRole } from "@/lib/salon-context";
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

function serverErrorResponse() {
  return NextResponse.json({ success: false, error: COMPLETE_MESSAGES.serverError }, { status: 500 });
}

/**
 * „Nie przyszedł”: oznaczenie cofają tylko właściciel i recepcja (trasa
 * no-show), więc pracownik dostaje tekst, kto może to zrobić.
 */
function noShowConflictResponse(role: SalonRole | null) {
  const message =
    role === "employee" ? COMPLETE_MESSAGES.noShowEmployee : NO_SHOW_COMPLETE_BLOCKED_MESSAGE;
  return errorResponse(409, NO_SHOW_COMPLETE_BLOCKED_CODE, message);
}

function appointmentNotFoundResponse() {
  return errorResponse(
    404,
    COMPLETE_ERROR_CODES.appointmentNotFound,
    COMPLETE_MESSAGES.appointmentNotFound
  );
}

/**
 * Odpowiedź dla wizyty, której nie da się zakończyć — wspólna dla
 * sprawdzenia pod blokadą wiersza i dla zapisu, który nie trafił w wiersz.
 * `null` dla statusu spoza listy: trasa oddaje wtedy 500 z logiem statusu.
 */
function notCompletableResponse(status: string, role: SalonRole | null): NextResponse | null {
  if (status === "completed") {
    return errorResponse(409, APPOINTMENT_COMPLETED_CODE, COMPLETE_MESSAGES.appointmentCompleted);
  }
  if (status === "cancelled") {
    return errorResponse(
      400,
      COMPLETE_ERROR_CODES.appointmentCancelled,
      COMPLETE_MESSAGES.appointmentCancelled
    );
  }
  if (status === NO_SHOW_STATUS) {
    return noShowConflictResponse(role);
  }
  return null;
}

/**
 * Body bez `commissionPercentage` dla ról innych niż właściciel. Stawkę
 * prowizji dla konkretnej wizyty zmienia tylko właściciel; pracownik
 * i recepcja dostają stawkę z danych pracownika. Pole jest pomijane przed
 * walidacją, nie odrzucane: dialog wysyła je zawsze, więc odrzucenie
 * zablokowałoby zakończenie każdej wizyty przez te role.
 */
function bodyForRole(body: unknown, role: SalonRole): unknown {
  if (role === "owner" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const rest: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete rest.commissionPercentage;
  return rest;
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
  // Do odpowiedzi i logu w `catch`: rola wołającego i id wizyty po walidacji.
  let callerRole: SalonRole | null = null;
  let appointmentId: string | null = null;
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Faza 3 (role): owner/receptionist domykają dowolną wizytę salonu,
    // employee wyłącznie własną (sprawdzenie po pobraniu wizyty niżej).
    const ctx = await getSalonContext();
    if (!ctx) {
      return errorResponse(404, COMPLETE_ERROR_CODES.salonNotFound, COMPLETE_MESSAGES.salonNotFound);
    }
    const salonId = ctx.salonId;
    callerRole = ctx.role;

    const { id } = await params;
    // Niepoprawny identyfikator dawał błąd bazy (22P02) i 500.
    if (!isValidUuid(id)) {
      return errorResponse(400, COMPLETE_ERROR_CODES.invalidId, COMPLETE_MESSAGES.invalidId);
    }
    appointmentId = id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, COMPLETE_ERROR_CODES.invalidJson, COMPLETE_MESSAGES.invalidJson);
    }

    // Server-side validation with Zod schema. Sparsowane dane, nie surowe body:
    // schemat zamienia kwotę na tekst dla kolumny numeric. Stawka prowizji
    // z body tylko od właściciela (pomijana przed walidacją u innych ról).
    const parsed = parseBody(completeAppointmentSchema, bodyForRole(body, ctx.role));
    if (!parsed.ok) {
      return NextResponse.json(
        {
          ...parsed.error,
          error: COMPLETE_MESSAGES.validationFailed,
          code: COMPLETE_ERROR_CODES.validationFailed,
        },
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

      // Wizyta zakończona, anulowana albo „Nie przyszedł” — przed zapisami.
      if (NOT_COMPLETABLE_STATUSES.includes(appointment.status)) {
        throw new AppointmentNotCompletableError(appointment.status);
      }

      // Usługa zgodna z wizytą spod blokady. Gdy odczyt czekał na blokadę,
      // a w tym czasie zatwierdzono zmianę usługi wizyty, Postgres sprawdza
      // ponownie tylko nową wersję wiersza wizyty, z usługą z pierwotnego
      // odczytu: złączenie przestaje pasować i usługa wraca jako NULL (albo
      // stara). Wtedy usługa jest czytana jeszcze raz, po identyfikatorze
      // z zablokowanej wizyty — inaczej prowizja i zużycie by przepadły.
      let service = appointment.serviceId ? row.service : null;
      if (appointment.serviceId && service?.id !== appointment.serviceId) {
        const [current] = await tx
          .select()
          .from(services)
          .where(and(eq(services.id, appointment.serviceId), eq(services.salonId, salonId)))
          .limit(1);
        service = current ?? null;
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

      // Stawka: z body (tylko właściciel — u innych ról pole pominięte przed
      // walidacją), inaczej z danych pracownika, inaczej domyślna.
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
        let priceInvalidMessage: string = COMPLETE_MESSAGES.servicePriceInvalid;

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
          priceInvalidMessage = COMPLETE_MESSAGES.employeePriceInvalid;
        }

        // 'NaN' albo 'Infinity' w kolumnie numeric dałyby prowizję „NaN”
        // albo 500 z bazy, a cena ujemna — ujemną prowizję (potrącenie
        // u pracownika). Błąd z kodem wycofuje całą transakcję; tekst wskazuje
        // cenę, której użyto (usługi albo pracownika).
        if (!Number.isFinite(effectivePrice) || effectivePrice < 0) {
          throw new CompletionDataError(COMPLETE_ERROR_CODES.servicePriceInvalid, priceInvalidMessage);
        }
        if (!Number.isFinite(commPct)) {
          throw new CompletionDataError(
            COMPLETE_ERROR_CODES.commissionRateInvalid,
            COMPLETE_MESSAGES.commissionRateInvalid
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

        // Log prowizji dopiero po zatwierdzeniu transakcji (w trasie), sam id.
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
        data: {
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
        },
        // Tylko do logu po zatwierdzeniu — nie trafia do odpowiedzi.
        serviceId: service?.id ?? null,
      };
    });
    const result = txResult.data;

    // Po zatwierdzeniu transakcji: log nie twierdzi zapisu, który COMMIT
    // wycofał. Same identyfikatory — bez pracownika, nazw, cen, stawek, kwot
    // i stanów magazynu (są w bazie).
    logger.info("Appointment marked as completed", { appointmentId: id });
    logger.info("Treatment record saved", { appointmentId: id });
    if (result.commission) {
      logger.info("Commission recorded", { appointmentId: id, commissionId: result.commission.id });
    }
    for (const deduction of result.stockDeductions) {
      logger.info("Stock deducted", { appointmentId: id, productId: deduction.productId });
    }
    if (result.stockDeductions.length > 0 && txResult.serviceId) {
      logger.info("Auto-deducted products for service", {
        appointmentId: id,
        serviceId: txResult.serviceId,
      });
    }
    for (const deduction of result.stockDeductions) {
      if (deduction.lowStockAlert?.notificationSent) {
        logger.info("Low stock alert notification sent", {
          appointmentId: id,
          productId: deduction.productId,
        });
      }
    }
    if (result.loyalty) {
      logger.info("Loyalty points awarded", {
        appointmentId: id,
        pointsAwarded: result.loyalty.pointsAwarded,
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: COMPLETE_MESSAGES.success,
    });
  } catch (error) {
    if (error instanceof AppointmentNotCompletableError) {
      // Wiersz zniknął po odczycie → 404.
      if (error.currentStatus === null) return appointmentNotFoundResponse();
      const response = notCompletableResponse(error.currentStatus, callerRole);
      if (response) return response;
      // Status spoza listy przy nieudanym zapisie: stan, którego trasa nie
      // obsługuje (np. nowy status wizyty). Transakcja wycofana, więc nic się
      // nie zapisało; 500 z logiem statusu zamiast mylącego kodu.
      logger.error("Appointment completion status not handled", {
        appointmentId,
        status: error.currentStatus,
      });
      return serverErrorResponse();
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
    return serverErrorResponse();
  }
}

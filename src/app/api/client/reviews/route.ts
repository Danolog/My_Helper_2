import { NextResponse } from "next/server";
// eslint-disable-next-line no-restricted-imports -- kontekst klienta (scope po userId z sesji)
import { db } from "@/lib/db";
import { reviews, appointments, employees, services, salons } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";

/**
 * Kontekst KLIENTA — surowy `db`, NIE `forSalon` (ADR-001 sekcja 4 / R2).
 * Lista MOICH opinii: join opinii->wizyty z filtrem `eq(appointments.bookedByUserId,
 * userId)` z SESJI. Opinie klienta rozciągają się na wiele salonów — kontekst
 * pojedynczego salonu właściciela (forSalon) nie pasuje.
 */
// GET /api/client/reviews - List all reviews by the authenticated user
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;

    // Join reviews with appointments to find reviews belonging to this user,
    // and include related salon, employee, and service info for display
    const result = await db
      .select({
        review: reviews,
        appointment: appointments,
        employee: employees,
        service: services,
        salon: salons,
      })
      .from(reviews)
      .innerJoin(appointments, eq(reviews.appointmentId, appointments.id))
      .leftJoin(employees, eq(reviews.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(salons, eq(reviews.salonId, salons.id))
      .where(eq(appointments.bookedByUserId, userId))
      .orderBy(desc(reviews.createdAt));

    const formattedReviews = result.map((row) => ({
      id: row.review.id,
      rating: row.review.rating,
      comment: row.review.comment,
      status: row.review.status,
      createdAt: row.review.createdAt,
      appointmentId: row.review.appointmentId,
      salonId: row.review.salonId,
      salonName: row.salon?.name || "Nieznany salon",
      employeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : "Nieznany",
      serviceName: row.service?.name || "Nieznana usluga",
      appointmentDate: row.appointment.startTime,
    }));

    return NextResponse.json({
      success: true,
      data: formattedReviews,
      count: formattedReviews.length,
    });
  } catch (error) {
    logger.error("[Client Reviews API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac opinii" },
      { status: 500 }
    );
  }
}

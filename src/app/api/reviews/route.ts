import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reviews, salons, clients, employees, services, appointments } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/reviews - List reviews for the owner's salon with optional status filter
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // 'pending', 'approved', 'rejected', or null for all

    // Build filter conditions
    const conditions = [eq(reviews.salonId, salon.id)];
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      conditions.push(eq(reviews.status, status));
    }

    const result = await db
      .select({
        review: reviews,
        client: clients,
        employee: employees,
        service: services,
        appointment: appointments,
      })
      .from(reviews)
      .leftJoin(clients, eq(reviews.clientId, clients.id))
      .leftJoin(employees, eq(reviews.employeeId, employees.id))
      .leftJoin(appointments, eq(reviews.appointmentId, appointments.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(...conditions))
      .orderBy(desc(reviews.createdAt));

    const formattedReviews = result.map((row) => ({
      id: row.review.id,
      rating: row.review.rating,
      comment: row.review.comment,
      ownerResponse: row.review.ownerResponse,
      ownerResponseAt: row.review.ownerResponseAt,
      status: row.review.status,
      createdAt: row.review.createdAt,
      appointmentId: row.review.appointmentId,
      clientName: row.client
        ? `${row.client.firstName} ${row.client.lastName}`
        : "Anonimowy klient",
      clientEmail: row.client?.email || null,
      employeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : "Nieprzypisany",
      serviceName: row.service?.name || "Nieznana usluga",
      appointmentDate: row.appointment?.startTime || null,
    }));

    console.log(
      `[Reviews Moderation API] GET: ${formattedReviews.length} reviews found (status: ${status || "all"}) for salon ${salon.id}`
    );

    return NextResponse.json({
      success: true,
      data: formattedReviews,
      count: formattedReviews.length,
    });
  } catch (error) {
    console.error("[Reviews Moderation API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac opinii" },
      { status: 500 }
    );
  }
}

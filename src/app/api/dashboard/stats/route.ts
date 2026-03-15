import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  salons,
  workSchedules,
} from "@/lib/schema";
import { eq, and, gte, lte, not, inArray } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
/**
 * Compute date boundaries in the Europe/Warsaw timezone.
 * This ensures correct "today" boundaries regardless of the server's local timezone.
 */
function getWarsawDateBoundaries() {
  const now = new Date();

  // Get current date parts in Warsaw timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const warsawDateStr = formatter.format(now); // "YYYY-MM-DD"
  const parts = warsawDateStr.split("-");
  const year = parseInt(parts[0] ?? "2026", 10);
  const month = parseInt(parts[1] ?? "1", 10) - 1; // 0-indexed
  const day = parseInt(parts[2] ?? "1", 10);

  // Create date boundaries using Warsaw date parts
  // These Date objects represent midnight in the server's local time for the Warsaw calendar date
  const todayStart = new Date(year, month, day, 0, 0, 0, 0);
  const todayEnd = new Date(year, month, day, 23, 59, 59, 999);

  const thirtyDaysAgo = new Date(year, month, day - 30, 0, 0, 0, 0);
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // Get day of week for Warsaw's "today"
  const todayDow = todayStart.getDay();

  return { now, todayStart, todayEnd, thirtyDaysAgo, monthStart, monthEnd, todayDow };
}

// GET /api/dashboard/stats - Dashboard overview data
// Returns: today's appointments, employees working today, cancellation stats, and 30-day stats
export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Verify the authenticated user owns the requested salon
    const [salon] = await db
      .select({ id: salons.id })
      .from(salons)
      .where(and(eq(salons.id, salonId), eq(salons.ownerId, user.id)))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Brak dostepu do tego salonu" },
        { status: 403 }
      );
    }

    // Date boundaries using Europe/Warsaw timezone
    const { todayStart, todayEnd, thirtyDaysAgo, monthStart, monthEnd, todayDow } =
      getWarsawDateBoundaries();

    // ─── Run independent queries in parallel ──────────────────
    const [todayAppointments, salonEmployees, monthAppointments, last30Appointments, newClients30d] =
      await Promise.all([
        // Today's appointments
        db
          .select({
            id: appointments.id,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            status: appointments.status,
            notes: appointments.notes,
            clientFirstName: clients.firstName,
            clientLastName: clients.lastName,
            clientPhone: clients.phone,
            employeeId: employees.id,
            employeeFirstName: employees.firstName,
            employeeLastName: employees.lastName,
            employeeColor: employees.color,
            serviceName: services.name,
            servicePrice: services.basePrice,
            serviceDuration: services.baseDuration,
          })
          .from(appointments)
          .leftJoin(clients, eq(appointments.clientId, clients.id))
          .leftJoin(employees, eq(appointments.employeeId, employees.id))
          .leftJoin(services, eq(appointments.serviceId, services.id))
          .where(
            and(
              eq(appointments.salonId, salonId),
              gte(appointments.startTime, todayStart),
              lte(appointments.startTime, todayEnd),
              not(eq(appointments.status, "cancelled"))
            )
          )
          .orderBy(appointments.startTime),

        // Active employees for this salon
        db
          .select({
            id: employees.id,
            firstName: employees.firstName,
            lastName: employees.lastName,
            color: employees.color,
            role: employees.role,
          })
          .from(employees)
          .where(
            and(eq(employees.salonId, salonId), eq(employees.isActive, true))
          ),

        // Cancellation statistics (this month)
        db
          .select({
            status: appointments.status,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.salonId, salonId),
              gte(appointments.startTime, monthStart),
              lte(appointments.startTime, monthEnd)
            )
          ),

        // Last 30 days statistics
        db
          .select({
            status: appointments.status,
            servicePrice: services.basePrice,
            discountAmount: appointments.discountAmount,
          })
          .from(appointments)
          .leftJoin(services, eq(appointments.serviceId, services.id))
          .where(
            and(
              eq(appointments.salonId, salonId),
              gte(appointments.startTime, thirtyDaysAgo),
              lte(appointments.startTime, todayEnd)
            )
          ),

        // New clients last 30 days
        db
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.salonId, salonId),
              gte(clients.createdAt, thirtyDaysAgo)
            )
          ),
      ]);

    // ─── Employees working today (depends on salonEmployees) ──
    const employeeIds = salonEmployees.map((e) => e.id);
    let todaySchedules: { employeeId: string; startTime: string; endTime: string }[] = [];
    if (employeeIds.length > 0) {
      todaySchedules = await db
        .select({
          employeeId: workSchedules.employeeId,
          startTime: workSchedules.startTime,
          endTime: workSchedules.endTime,
        })
        .from(workSchedules)
        .where(
          and(
            inArray(workSchedules.employeeId, employeeIds),
            eq(workSchedules.dayOfWeek, todayDow)
          )
        );
    }

    // Map schedules to employees
    const scheduleMap = new Map(
      todaySchedules.map((s) => [s.employeeId, s])
    );

    const employeesToday = salonEmployees.map((emp) => {
      const schedule = scheduleMap.get(emp.id);
      const appointmentCount = todayAppointments.filter(
        (a) => a.employeeId === emp.id
      ).length;
      return {
        ...emp,
        isWorkingToday: !!schedule,
        workStart: schedule?.startTime ?? null,
        workEnd: schedule?.endTime ?? null,
        appointmentCount,
      };
    });

    // ─── Process cancellation statistics ──────────────────────
    const totalThisMonth = monthAppointments.length;
    const cancelledThisMonth = monthAppointments.filter(
      (a) => a.status === "cancelled"
    ).length;
    const noShowThisMonth = monthAppointments.filter(
      (a) => a.status === "no_show"
    ).length;
    const cancellationRate =
      totalThisMonth > 0
        ? ((cancelledThisMonth + noShowThisMonth) / totalThisMonth) * 100
        : 0;

    // ─── Process last 30 days statistics ──────────────────────
    const total30d = last30Appointments.length;
    const completed30d = last30Appointments.filter(
      (a) => a.status === "completed"
    ).length;
    const cancelled30d = last30Appointments.filter(
      (a) => a.status === "cancelled"
    ).length;

    // Revenue from completed appointments
    let revenue30d = 0;
    for (const a of last30Appointments) {
      if (a.status === "completed" && a.servicePrice) {
        const price = parseFloat(a.servicePrice);
        const discount = a.discountAmount ? parseFloat(a.discountAmount) : 0;
        revenue30d += price - discount;
      }
    }

    // Average per day (last 30 days)
    const avgPerDay = total30d > 0 ? Math.round(total30d / 30) : 0;

    return NextResponse.json({
      success: true,
      data: {
        todayAppointments: todayAppointments.map((a) => ({
          id: a.id,
          startTime: a.startTime,
          endTime: a.endTime,
          status: a.status,
          notes: a.notes,
          clientName:
            a.clientFirstName && a.clientLastName
              ? `${a.clientFirstName} ${a.clientLastName}`
              : "Brak klienta",
          clientPhone: a.clientPhone,
          employeeId: a.employeeId,
          employeeName:
            a.employeeFirstName && a.employeeLastName
              ? `${a.employeeFirstName} ${a.employeeLastName}`
              : "Nieprzypisany",
          employeeColor: a.employeeColor,
          serviceName: a.serviceName || "Brak uslugi",
          servicePrice: a.servicePrice ? parseFloat(a.servicePrice) : 0,
          serviceDuration: a.serviceDuration || 0,
        })),
        employeesToday,
        cancellationStats: {
          totalThisMonth,
          cancelledThisMonth,
          noShowThisMonth,
          cancellationRate: Math.round(cancellationRate * 10) / 10,
        },
        last30Days: {
          totalAppointments: total30d,
          completedAppointments: completed30d,
          cancelledAppointments: cancelled30d,
          revenue: Math.round(revenue30d * 100) / 100,
          avgPerDay,
          newClients: newClients30d.length,
        },
      },
    });
  } catch (error) {
    logger.error("[Dashboard Stats API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac statystyk dashboardu" },
      { status: 500 }
    );
  }
}

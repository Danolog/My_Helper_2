import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  workSchedules,
} from "@/lib/schema";
import { eq, and, gte, lte, not, inArray } from "drizzle-orm";

// GET /api/dashboard/stats - Dashboard overview data
// Returns: today's appointments, employees working today, cancellation stats, and 30-day stats
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Date boundaries
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // ─── Today's appointments ───────────────────────────────
    const todayAppointments = await db
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
      .orderBy(appointments.startTime);

    // ─── Employees working today ────────────────────────────
    // Get today's day of week (0=Sunday, 1=Monday, ...)
    const todayDow = now.getDay();

    // Get all active employees for this salon
    const salonEmployees = await db
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
      );

    // Get work schedules for today's day of week
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

    // ─── Cancellation statistics (this month) ───────────────
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthAppointments = await db
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
      );

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

    // ─── Last 30 days statistics ────────────────────────────
    const last30Appointments = await db
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
      );

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

    // ─── New clients last 30 days ───────────────────────────
    const newClients30d = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          gte(clients.createdAt, thirtyDaysAgo)
        )
      );

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
    console.error("[Dashboard Stats API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac statystyk dashboardu" },
      { status: 500 }
    );
  }
}

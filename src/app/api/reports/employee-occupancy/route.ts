import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  employees,
  workSchedules,
  services,
  timeBlocks,
} from "@/lib/schema";
import { eq, and, gte, lte, ne, inArray } from "drizzle-orm";

/**
 * Parses a time string like "09:00" into total minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Calculates the overlap in minutes between two time ranges.
 * Returns 0 if there is no overlap.
 */
function calculateOverlapMinutes(
  rangeAStart: Date,
  rangeAEnd: Date,
  rangeBStart: Date,
  rangeBEnd: Date
): number {
  const overlapStart = rangeAStart > rangeBStart ? rangeAStart : rangeBStart;
  const overlapEnd = rangeAEnd < rangeBEnd ? rangeAEnd : rangeBEnd;
  const overlapMs = overlapEnd.getTime() - overlapStart.getTime();
  return overlapMs > 0 ? overlapMs / (1000 * 60) : 0;
}

// GET /api/reports/employee-occupancy - Employee occupancy/utilization report
export async function GET(request: Request) {
  try {
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

    // Default date range: current month if not specified
    const startDate = dateFrom
      ? new Date(dateFrom)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = dateTo ? new Date(dateTo) : new Date();
    endDate.setHours(23, 59, 59, 999);

    // 1. Get all active employees for the salon
    const activeEmployees = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        color: employees.color,
      })
      .from(employees)
      .where(
        and(eq(employees.salonId, salonId), eq(employees.isActive, true))
      );

    if (activeEmployees.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          employees: [],
          summary: {
            totalEmployees: 0,
            avgOccupancy: "0.0",
            totalAvailableHours: "0.0",
            totalAppointmentHours: "0.0",
          },
          filters: {
            salonId,
            dateFrom: dateFrom || startDate.toISOString().split("T")[0],
            dateTo: dateTo || endDate.toISOString().split("T")[0],
          },
        },
      });
    }

    const employeeIds = activeEmployees.map((e) => e.id);

    // 2. Batch: Get work schedules for ALL employees (1 query instead of N)
    const allSchedules = await db
      .select({
        employeeId: workSchedules.employeeId,
        dayOfWeek: workSchedules.dayOfWeek,
        startTime: workSchedules.startTime,
        endTime: workSchedules.endTime,
      })
      .from(workSchedules)
      .where(inArray(workSchedules.employeeId, employeeIds));

    const schedulesByEmployee: Record<
      string,
      { dayOfWeek: number; startTime: string; endTime: string }[]
    > = {};
    for (const s of allSchedules) {
      (schedulesByEmployee[s.employeeId] ??= []).push(s);
    }

    // 3. Batch: Get time blocks for ALL employees in date range (1 query instead of N)
    const allBlocks = await db
      .select({
        employeeId: timeBlocks.employeeId,
        startTime: timeBlocks.startTime,
        endTime: timeBlocks.endTime,
        blockType: timeBlocks.blockType,
      })
      .from(timeBlocks)
      .where(
        and(
          inArray(timeBlocks.employeeId, employeeIds),
          lte(timeBlocks.startTime, endDate),
          gte(timeBlocks.endTime, startDate)
        )
      );

    const blocksByEmployee: Record<
      string,
      { startTime: Date; endTime: Date; blockType: string }[]
    > = {};
    for (const b of allBlocks) {
      (blocksByEmployee[b.employeeId] ??= []).push(b);
    }

    // 4. Batch: Get all non-cancelled appointments in the date range (1 query instead of N)
    const allAppointments = await db
      .select({
        employeeId: appointments.employeeId,
        startTime: appointments.startTime,
        endTime: appointments.endTime,
        status: appointments.status,
        basePrice: services.basePrice,
        discountAmount: appointments.discountAmount,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.salonId, salonId),
          inArray(appointments.employeeId, employeeIds),
          ne(appointments.status, "cancelled"),
          gte(appointments.startTime, startDate),
          lte(appointments.startTime, endDate)
        )
      );

    const appointmentsByEmployee: Record<
      string,
      {
        startTime: Date;
        endTime: Date;
        status: string;
        basePrice: string | null;
        discountAmount: string | null;
      }[]
    > = {};
    for (const a of allAppointments) {
      (appointmentsByEmployee[a.employeeId] ??= []).push(a);
    }

    // 5. Calculate metrics for each employee
    const employeeMetrics: {
      employeeId: string;
      employeeName: string;
      color: string | null;
      availableHours: number;
      appointmentHours: number;
      appointmentCount: number;
      occupancyPercentage: number;
      revenue: number;
      completedCount: number;
    }[] = [];

    for (const emp of activeEmployees) {
      const empSchedules = schedulesByEmployee[emp.id] || [];
      const empBlocks = blocksByEmployee[emp.id] || [];
      const empAppointments = appointmentsByEmployee[emp.id] || [];

      // Calculate available hours by iterating through each day in the range
      let totalAvailableMinutes = 0;
      const currentDay = new Date(startDate);

      while (currentDay <= endDate) {
        const dayOfWeek = currentDay.getDay(); // 0=Sunday, 1=Monday, etc.

        // Find work schedule for this day of week
        const daySchedule = empSchedules.find(
          (s) => s.dayOfWeek === dayOfWeek
        );

        if (daySchedule) {
          const scheduleStartMinutes = parseTimeToMinutes(
            daySchedule.startTime
          );
          const scheduleEndMinutes = parseTimeToMinutes(daySchedule.endTime);
          let dayAvailableMinutes = scheduleEndMinutes - scheduleStartMinutes;

          if (dayAvailableMinutes > 0) {
            // Subtract time blocks that overlap with this day's work hours
            const dayStart = new Date(currentDay);
            dayStart.setHours(
              Math.floor(scheduleStartMinutes / 60),
              scheduleStartMinutes % 60,
              0,
              0
            );

            const dayEnd = new Date(currentDay);
            dayEnd.setHours(
              Math.floor(scheduleEndMinutes / 60),
              scheduleEndMinutes % 60,
              0,
              0
            );

            for (const block of empBlocks) {
              const overlapMinutes = calculateOverlapMinutes(
                dayStart,
                dayEnd,
                new Date(block.startTime),
                new Date(block.endTime)
              );
              dayAvailableMinutes -= overlapMinutes;
            }

            // Ensure we don't go negative
            totalAvailableMinutes += Math.max(0, dayAvailableMinutes);
          }
        }

        // Move to next day
        currentDay.setDate(currentDay.getDate() + 1);
      }

      // Calculate appointment hours (non-cancelled)
      let totalAppointmentMinutes = 0;
      let totalRevenue = 0;
      let completedCount = 0;

      for (const appt of empAppointments) {
        const durationMs =
          new Date(appt.endTime).getTime() -
          new Date(appt.startTime).getTime();
        const durationMinutes = durationMs / (1000 * 60);
        totalAppointmentMinutes += durationMinutes;

        // Revenue only from completed appointments
        if (appt.status === "completed") {
          const price = parseFloat(appt.basePrice || "0");
          const discount = parseFloat(appt.discountAmount || "0");
          totalRevenue += Math.max(0, price - discount);
          completedCount += 1;
        }
      }

      const availableHours = totalAvailableMinutes / 60;
      const appointmentHours = totalAppointmentMinutes / 60;
      const occupancyPercentage =
        availableHours > 0 ? (appointmentHours / availableHours) * 100 : 0;

      employeeMetrics.push({
        employeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        color: emp.color,
        availableHours,
        appointmentHours,
        appointmentCount: empAppointments.length,
        occupancyPercentage,
        revenue: totalRevenue,
        completedCount,
      });
    }

    // Sort by occupancy percentage descending
    employeeMetrics.sort(
      (a, b) => b.occupancyPercentage - a.occupancyPercentage
    );

    // Calculate summary totals
    const totalAvailableHours = employeeMetrics.reduce(
      (sum, e) => sum + e.availableHours,
      0
    );
    const totalAppointmentHours = employeeMetrics.reduce(
      (sum, e) => sum + e.appointmentHours,
      0
    );
    const avgOccupancy =
      employeeMetrics.length > 0
        ? employeeMetrics.reduce((sum, e) => sum + e.occupancyPercentage, 0) /
          employeeMetrics.length
        : 0;
    const totalRevenue = employeeMetrics.reduce(
      (sum, e) => sum + e.revenue,
      0
    );

    // CSV export
    if (format === "csv") {
      const csvRows: string[] = [];
      const BOM = "\uFEFF";

      // Summary section
      csvRows.push("RAPORT OBCIAZENIA PRACOWNIKOW");
      csvRows.push(
        `Okres,${dateFrom || startDate.toISOString().split("T")[0]},-,${dateTo || endDate.toISOString().split("T")[0]}`
      );
      csvRows.push(`Liczba pracownikow,${employeeMetrics.length}`);
      csvRows.push(`Srednie obciazenie,${avgOccupancy.toFixed(1)}%`);
      csvRows.push(
        `Laczne godziny dostepne,${totalAvailableHours.toFixed(1)} h`
      );
      csvRows.push(
        `Laczne godziny wizyt,${totalAppointmentHours.toFixed(1)} h`
      );
      csvRows.push(`Laczny przychod,${totalRevenue.toFixed(2)} PLN`);
      csvRows.push("");

      // Employee details
      csvRows.push("SZCZEGOLY WG PRACOWNIKA");
      csvRows.push(
        "Pracownik,Godziny dostepne,Godziny wizyt,Liczba wizyt,Obciazenie (%),Przychod (PLN),Wizyty zakonczone"
      );

      for (const emp of employeeMetrics) {
        csvRows.push(
          `"${emp.employeeName}",${emp.availableHours.toFixed(1)},${emp.appointmentHours.toFixed(1)},${emp.appointmentCount},${emp.occupancyPercentage.toFixed(1)},${emp.revenue.toFixed(2)},${emp.completedCount}`
        );
      }

      const csvContent = BOM + csvRows.join("\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="raport-obciazenie-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.csv"`,
        },
      });
    }

    // JSON response
    return NextResponse.json({
      success: true,
      data: {
        employees: employeeMetrics.map((e) => ({
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          color: e.color,
          availableHours: e.availableHours.toFixed(1),
          appointmentHours: e.appointmentHours.toFixed(1),
          appointmentCount: e.appointmentCount,
          occupancyPercentage: e.occupancyPercentage.toFixed(1),
          revenue: e.revenue.toFixed(2),
          completedCount: e.completedCount,
        })),
        summary: {
          totalEmployees: employeeMetrics.length,
          avgOccupancy: avgOccupancy.toFixed(1),
          totalAvailableHours: totalAvailableHours.toFixed(1),
          totalAppointmentHours: totalAppointmentHours.toFixed(1),
          totalRevenue: totalRevenue.toFixed(2),
        },
        filters: {
          salonId,
          dateFrom: dateFrom || startDate.toISOString().split("T")[0],
          dateTo: dateTo || endDate.toISOString().split("T")[0],
        },
      },
    });
  } catch (error) {
    console.error("[Employee Occupancy Report API] Database error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate employee occupancy report",
      },
      { status: 500 }
    );
  }
}

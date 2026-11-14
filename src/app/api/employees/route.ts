import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { createEmployeeSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { getSalonContext, requireSalonStaff } from "@/lib/salon-context";
import { employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import type { z } from "zod";
// Predefined palette of distinct colors for employees
const EMPLOYEE_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#84cc16", // Lime
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#a855f7", // Purple
];

// Get next available color for a salon
async function getNextAvailableColor(salonId: string): Promise<string> {
  try {
    const existingEmployees = await forSalon(salonId).raw((tx) =>
      tx
        .select({ color: employees.color })
        .from(employees)
        .where(eq(employees.salonId, salonId))
    );

    const usedColors = new Set(existingEmployees.map((e) => e.color).filter(Boolean));

    // Find first unused color
    for (const color of EMPLOYEE_COLORS) {
      if (!usedColors.has(color)) {
        return color;
      }
    }

    // If all colors used, cycle through with index
    const index = existingEmployees.length % EMPLOYEE_COLORS.length;
    return EMPLOYEE_COLORS[index] ?? EMPLOYEE_COLORS[0] ?? "#3b82f6";
  } catch {
    return EMPLOYEE_COLORS[0] ?? "#3b82f6";
  }
}

// GET /api/employees - List all employees
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Employees API] GET",
    errorMessage: "Failed to fetch employees",
  },
  async ({ request }) => {
    // Tenant isolation (ADR-001): derive the salon from the session, never
    // trust a client-supplied salonId in the query string (IDOR risk).
    // Faza 3 (role): odczyt listy pracowników dla wszystkich ról (podgląd
    // kalendarza wymaga listy pracowników); mutacje zostają owner-only.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    const salonId = ctx.salonId;

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    logger.info("[Employees API] GET with params", { salonId, activeOnly });

    // Select only the columns needed by list consumers (excludes commissionRate, timestamps)
    const employeeColumns = {
      id: employees.id,
      salonId: employees.salonId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      phone: employees.phone,
      email: employees.email,
      photoUrl: employees.photoUrl,
      role: employees.role,
      isActive: employees.isActive,
      color: employees.color,
      // Faza 3: stan polaczenia konta (sekcja "Konto pracownika" w UI)
      userId: employees.userId,
    };

    const allEmployees = await forSalon(salonId).raw((tx) =>
      tx
        .select(employeeColumns)
        .from(employees)
        .where(
          activeOnly
            ? and(eq(employees.salonId, salonId), eq(employees.isActive, true))
            : eq(employees.salonId, salonId)
        )
    );

    logger.info(`[Employees API] Query returned ${allEmployees.length} rows`);

    return NextResponse.json({
      success: true,
      data: allEmployees,
      count: allEmployees.length,
    });
  }
);

// POST /api/employees - Create a new employee
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    schema: createEmployeeSchema as z.ZodType<{
      salonId: string;
      firstName: string;
      lastName: string;
      phone?: string | null;
      email?: string | null;
      photoUrl?: string | null;
      role?: string;
      color?: string;
    }>,
    logLabel: "[Employees API] POST",
    errorMessage: "Failed to create employee",
  },
  async ({ body }) => {
    // P1 (przegląd Ryana): salon WYŁĄCZNIE z sesji — wcześniej forSalon(body.salonId)
    // pozwalał każdemu zalogowanemu kontu dodać pracownika do cudzego salonu.
    // body.salonId tylko porównywany (inny => 403). Dodawanie pracowników: tylko
    // właściciel (salons.ownerId), bez grantów — jak PUT /api/employees/[id].
    const guard = await requireSalonStaff({ roles: [], requestedSalonId: body.salonId });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;

    // userId celowo NIE jest przyjmowany z body — łączenie konta wyłącznie
    // przez PUT /api/employees/[id]/link-account (walidacje cross-tenant).
    const { firstName, lastName, phone, email, photoUrl, role, color } = body;

    // Get next available color if not provided
    const employeeColor = color || await getNextAvailableColor(salonId);

    logger.info(`[Employees API] Creating employee: ${firstName} ${lastName} with color ${employeeColor}`);
    const [newEmployee] = await forSalon(salonId).raw((tx) =>
      tx
      .insert(employees)
      .values({
        salonId,
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        photoUrl: photoUrl || null,
        role: role || "employee",
        color: employeeColor,
        isActive: true,
      })
      .returning()
    );

    logger.info(`[Employees API] Created employee with id: ${newEmployee?.id}`);

    return NextResponse.json({
      success: true,
      data: newEmployee,
    }, { status: 201 });
  }
);

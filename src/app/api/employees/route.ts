import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { validateBody, createEmployeeSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { apiRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
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
    const existingEmployees = await db
      .select({ color: employees.color })
      .from(employees)
      .where(eq(employees.salonId, salonId));

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
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    logger.info("[Employees API] GET with params", { salonId, activeOnly });

    // Select only the columns needed by list consumers (excludes userId, commissionRate, timestamps)
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
    };

    let allEmployees;
    if (salonId && activeOnly) {
      allEmployees = await db
        .select(employeeColumns)
        .from(employees)
        .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)));
    } else if (salonId) {
      allEmployees = await db
        .select(employeeColumns)
        .from(employees)
        .where(eq(employees.salonId, salonId));
    } else if (activeOnly) {
      allEmployees = await db
        .select(employeeColumns)
        .from(employees)
        .where(eq(employees.isActive, true));
    } else {
      allEmployees = await db.select(employeeColumns).from(employees);
    }

    logger.info(`[Employees API] Query returned ${allEmployees.length} rows`);

    return NextResponse.json({
      success: true,
      data: allEmployees,
      count: allEmployees.length,
    });
  } catch (error) {
    logger.error("[Employees API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}

// POST /api/employees - Create a new employee
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimitResult = apiRateLimit.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(createEmployeeSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { salonId, userId, firstName, lastName, phone, email, photoUrl, role, color } = body;

    // Get next available color if not provided
    const employeeColor = color || await getNextAvailableColor(salonId);

    logger.info(`[Employees API] Creating employee: ${firstName} ${lastName} with color ${employeeColor}`);
    const [newEmployee] = await db
      .insert(employees)
      .values({
        salonId,
        userId: userId || null,
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        photoUrl: photoUrl || null,
        role: role || "employee",
        color: employeeColor,
        isActive: true,
      })
      .returning();

    logger.info(`[Employees API] Created employee with id: ${newEmployee?.id}`);

    return NextResponse.json({
      success: true,
      data: newEmployee,
    }, { status: 201 });
  } catch (error) {
    logger.error("[Employees API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create employee" },
      { status: 500 }
    );
  }
}

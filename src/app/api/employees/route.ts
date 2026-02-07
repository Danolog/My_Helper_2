import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

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
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    console.log("[Employees API] GET with params:", { salonId, activeOnly });

    let allEmployees;
    if (salonId && activeOnly) {
      allEmployees = await db
        .select()
        .from(employees)
        .where(and(eq(employees.salonId, salonId), eq(employees.isActive, true)));
    } else if (salonId) {
      allEmployees = await db
        .select()
        .from(employees)
        .where(eq(employees.salonId, salonId));
    } else if (activeOnly) {
      allEmployees = await db
        .select()
        .from(employees)
        .where(eq(employees.isActive, true));
    } else {
      allEmployees = await db.select().from(employees);
    }

    console.log(`[Employees API] Query returned ${allEmployees.length} rows`);

    return NextResponse.json({
      success: true,
      data: allEmployees,
      count: allEmployees.length,
    });
  } catch (error) {
    console.error("[Employees API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch employees" },
      { status: 500 }
    );
  }
}

// POST /api/employees - Create a new employee
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, userId, firstName, lastName, phone, email, photoUrl, role, color } = body;

    if (!salonId || !firstName || !lastName) {
      return NextResponse.json(
        { success: false, error: "salonId, firstName, and lastName are required" },
        { status: 400 }
      );
    }

    // Get next available color if not provided
    const employeeColor = color || await getNextAvailableColor(salonId);

    console.log(`[Employees API] Creating employee: ${firstName} ${lastName} with color ${employeeColor}`);
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

    console.log(`[Employees API] Created employee with id: ${newEmployee?.id}`);

    return NextResponse.json({
      success: true,
      data: newEmployee,
    }, { status: 201 });
  } catch (error) {
    console.error("[Employees API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create employee" },
      { status: 500 }
    );
  }
}

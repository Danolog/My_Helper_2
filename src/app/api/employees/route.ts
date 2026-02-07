import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/employees - List all employees
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    console.log("[Employees API] GET with params:", { salonId, activeOnly });

    let query = db.select().from(employees);

    if (salonId) {
      query = query.where(eq(employees.salonId, salonId)) as typeof query;
    }
    if (activeOnly) {
      query = query.where(eq(employees.isActive, true)) as typeof query;
    }

    const allEmployees = await query;
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

    console.log(`[Employees API] Creating employee: ${firstName} ${lastName}`);
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
        color: color || "#3b82f6",
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

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employees } from "@/lib/schema";
import { eq } from "drizzle-orm";

// PUT /api/employees/commission-rate - Update employee's default commission rate
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { employeeId, commissionRate } = body;

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "Employee ID is required" },
        { status: 400 }
      );
    }

    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return NextResponse.json(
        {
          success: false,
          error: "Commission rate must be a number between 0 and 100",
        },
        { status: 400 }
      );
    }

    // Check if employee exists
    const [employee] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    // Update the commission rate
    const result = await db
      .update(employees)
      .set({ commissionRate: rate.toFixed(2) })
      .where(eq(employees.id, employeeId))
      .returning();

    const updated = result[0];
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Failed to update employee" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        commissionRate: updated.commissionRate,
      },
      message: `Prowizja dla ${updated.firstName} ${updated.lastName} ustawiona na ${rate}%`,
    });
  } catch (error) {
    console.error("[Commission Rate API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update commission rate" },
      { status: 500 }
    );
  }
}

// GET /api/employees/commission-rate - Get all employees with their commission rates
export async function GET() {
  try {
    const result = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        role: employees.role,
        color: employees.color,
        commissionRate: employees.commissionRate,
        isActive: employees.isActive,
      })
      .from(employees)
      .where(eq(employees.isActive, true))
      .orderBy(employees.firstName);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Commission Rate API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch commission rates" },
      { status: 500 }
    );
  }
}

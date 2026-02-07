import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { timeBlocks, employees } from "@/lib/schema";
import { eq, and, gte, lte } from "drizzle-orm";

// GET /api/time-blocks?employeeId=xxx&startDate=xxx&endDate=xxx
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const blockType = searchParams.get("blockType");

    console.log("[TimeBlocks API] GET with params:", { employeeId, startDate, endDate, blockType });

    const conditions = [];

    if (employeeId) {
      conditions.push(eq(timeBlocks.employeeId, employeeId));
    }
    if (blockType) {
      conditions.push(eq(timeBlocks.blockType, blockType));
    }
    if (startDate) {
      conditions.push(gte(timeBlocks.endTime, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(timeBlocks.startTime, new Date(endDate)));
    }

    let query = db
      .select({
        timeBlock: timeBlocks,
        employee: employees,
      })
      .from(timeBlocks)
      .leftJoin(employees, eq(timeBlocks.employeeId, employees.id));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = await query;
    console.log(`[TimeBlocks API] Query returned ${result.length} rows`);

    const formattedBlocks = result.map((row) => ({
      ...row.timeBlock,
      employee: row.employee,
    }));

    return NextResponse.json({
      success: true,
      data: formattedBlocks,
      count: formattedBlocks.length,
    });
  } catch (error) {
    console.error("[TimeBlocks API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch time blocks" },
      { status: 500 }
    );
  }
}

// POST /api/time-blocks - Create a new time block (vacation, break, etc.)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { employeeId, startTime, endTime, blockType, reason } = body;

    if (!employeeId || !startTime || !endTime || !blockType) {
      return NextResponse.json(
        { success: false, error: "employeeId, startTime, endTime, and blockType are required" },
        { status: 400 }
      );
    }

    // Validate block type
    const validTypes = ["break", "vacation", "personal", "holiday", "other"];
    if (!validTypes.includes(blockType)) {
      return NextResponse.json(
        { success: false, error: `Invalid blockType. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify employee exists
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

    // Validate date range
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (start >= end) {
      return NextResponse.json(
        { success: false, error: "startTime must be before endTime" },
        { status: 400 }
      );
    }

    console.log(`[TimeBlocks API] Creating ${blockType} block for employee: ${employeeId}`);

    const [newBlock] = await db
      .insert(timeBlocks)
      .values({
        employeeId,
        startTime: start,
        endTime: end,
        blockType,
        reason: reason || null,
      })
      .returning();

    console.log(`[TimeBlocks API] Created time block with id: ${newBlock?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newBlock,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[TimeBlocks API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create time block" },
      { status: 500 }
    );
  }
}

// DELETE /api/time-blocks - Delete a time block
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      );
    }

    console.log(`[TimeBlocks API] Deleting time block: ${id}`);

    const deleted = await db
      .delete(timeBlocks)
      .where(eq(timeBlocks.id, id))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Time block not found" },
        { status: 404 }
      );
    }

    console.log(`[TimeBlocks API] Deleted time block: ${id}`);

    return NextResponse.json({
      success: true,
      data: deleted[0],
      message: "Time block deleted successfully",
    });
  } catch (error) {
    console.error("[TimeBlocks API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete time block" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { eq, and, gte, lte, type SQL } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, createTimeBlockSchema } from "@/lib/api-validation";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { apiRateLimit } from "@/lib/rate-limit";
import { timeBlocks, employees } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/time-blocks?employeeId=xxx&startDate=xxx&endDate=xxx
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[TimeBlocks API] GET",
    errorMessage: "Failed to fetch time blocks",
  },
  async ({ request }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const blockType = searchParams.get("blockType");

    logger.info("[TimeBlocks API] GET with params", { employeeId, startDate, endDate, blockType });

    const conditions: SQL[] = [];

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

    // timeBlocks nie ma salonId — scope przez tabelę nadrzędną employees.
    conditions.push(eq(employees.salonId, salonId));

    const result = await forSalon(salonId).raw(async (tx) => {
      let query = tx
        .select({
          timeBlock: timeBlocks,
          employee: employees,
        })
        .from(timeBlocks)
        .leftJoin(employees, eq(timeBlocks.employeeId, employees.id));

      query = query.where(and(...conditions)) as typeof query;

      return await query;
    });
    logger.info(`[TimeBlocks API] Query returned ${result.length} rows`);

    const formattedBlocks = result.map((row) => ({
      ...row.timeBlock,
      employee: row.employee,
    }));

    return NextResponse.json({
      success: true,
      data: formattedBlocks,
      count: formattedBlocks.length,
    });
  }
);

// POST /api/time-blocks - Create a new time block (vacation, break, etc.)
export const POST = withApiHandler(
  {
    auth: "user",
    rateLimit: apiRateLimit,
    logLabel: "[TimeBlocks API] POST",
    errorMessage: "Failed to create time block",
  },
  async ({ request }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validationError = validateBody(createTimeBlockSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { employeeId, startTime, endTime, blockType, reason } = body;

    // Validate block type
    const validTypes = ["break", "vacation", "personal", "holiday", "other"];
    if (!validTypes.includes(blockType)) {
      return NextResponse.json(
        { success: false, error: `Invalid blockType. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify employee exists (w salonie wołającego — timeBlocks nie ma salonId,
    // scope przez tabelę nadrzędną employees)
    const employee = await forSalon(salonId).findOne(employees, employeeId);

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

    logger.info(`[TimeBlocks API] Creating ${blockType} block for employee: ${employeeId}`);

    // timeBlocks nie ma kolumny salonId — przynależność do salonu wynika ze
    // zweryfikowanego wyżej pracownika salonu.
    const [newBlock] = await forSalon(salonId).raw((tx) =>
      tx
        .insert(timeBlocks)
        .values({
          employeeId,
          startTime: start,
          endTime: end,
          blockType,
          reason: reason || null,
        })
        .returning()
    );

    logger.info(`[TimeBlocks API] Created time block with id: ${newBlock?.id}`);

    return NextResponse.json(
      {
        success: true,
        data: newBlock,
      },
      { status: 201 }
    );
  }
);

// DELETE /api/time-blocks - Delete a time block
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[TimeBlocks API] DELETE",
    errorMessage: "Failed to delete time block",
  },
  async ({ request }) => {
    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      );
    }

    logger.info(`[TimeBlocks API] Deleting time block: ${id}`);

    // timeBlocks nie ma salonId — sprawdzenie własności przez join z employees
    // i delete atomowo w jednej transakcji RLS; cudzy blok jest niewidoczny (404).
    const deleted = await forSalon(salonId).raw(async (tx) => {
      const [owned] = await tx
        .select({ id: timeBlocks.id })
        .from(timeBlocks)
        .innerJoin(employees, eq(timeBlocks.employeeId, employees.id))
        .where(and(eq(timeBlocks.id, id), eq(employees.salonId, salonId)))
        .limit(1);

      if (!owned) {
        return [];
      }

      return tx
        .delete(timeBlocks)
        .where(eq(timeBlocks.id, id))
        .returning();
    });

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Time block not found" },
        { status: 404 }
      );
    }

    logger.info(`[TimeBlocks API] Deleted time block: ${id}`);

    return NextResponse.json({
      success: true,
      data: deleted[0],
      message: "Time block deleted successfully",
    });
  }
);

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { services, serviceCategories } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/services - List all services
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    console.log("[Services API] GET with params:", { salonId, activeOnly });

    let query = db.select({
      service: services,
      category: serviceCategories,
    })
    .from(services)
    .leftJoin(serviceCategories, eq(services.categoryId, serviceCategories.id));

    if (salonId) {
      query = query.where(eq(services.salonId, salonId)) as typeof query;
    }
    if (activeOnly) {
      query = query.where(eq(services.isActive, true)) as typeof query;
    }

    const result = await query;
    console.log(`[Services API] Query returned ${result.length} rows`);

    const formattedServices = result.map((row) => ({
      ...row.service,
      category: row.category,
    }));

    return NextResponse.json({
      success: true,
      data: formattedServices,
      count: formattedServices.length,
    });
  } catch (error) {
    console.error("[Services API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

// POST /api/services - Create a new service
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, categoryId, name, description, basePrice, baseDuration } = body;

    if (!salonId || !name || !basePrice || !baseDuration) {
      return NextResponse.json(
        { success: false, error: "salonId, name, basePrice, and baseDuration are required" },
        { status: 400 }
      );
    }

    console.log(`[Services API] Creating service: ${name}`);
    const [newService] = await db
      .insert(services)
      .values({
        salonId,
        categoryId: categoryId || null,
        name,
        description: description || null,
        basePrice: basePrice.toString(),
        baseDuration: parseInt(baseDuration, 10),
        isActive: true,
      })
      .returning();

    console.log(`[Services API] Created service with id: ${newService?.id}`);

    return NextResponse.json({
      success: true,
      data: newService,
    }, { status: 201 });
  } catch (error) {
    console.error("[Services API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create service" },
      { status: 500 }
    );
  }
}

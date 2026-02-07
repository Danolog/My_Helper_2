import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serviceVariants, services } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/services/[id]/variants - List all variants for a service
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify service exists
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, id));

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const variants = await db
      .select()
      .from(serviceVariants)
      .where(eq(serviceVariants.serviceId, id));

    return NextResponse.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (error) {
    console.error("[Variants API] Error fetching variants:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch variants" },
      { status: 500 }
    );
  }
}

// POST /api/services/[id]/variants - Create a new variant
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, priceModifier, durationModifier } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: "Variant name is required" },
        { status: 400 }
      );
    }

    // Verify service exists
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, id));

    if (!service) {
      return NextResponse.json(
        { success: false, error: "Service not found" },
        { status: 404 }
      );
    }

    const [newVariant] = await db
      .insert(serviceVariants)
      .values({
        serviceId: id,
        name: name.trim(),
        priceModifier: (priceModifier ?? 0).toString(),
        durationModifier: parseInt(durationModifier ?? "0", 10),
      })
      .returning();

    console.log(`[Variants API] Created variant "${name}" for service ${id}`);

    return NextResponse.json(
      {
        success: true,
        data: newVariant,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Variants API] Error creating variant:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create variant" },
      { status: 500 }
    );
  }
}

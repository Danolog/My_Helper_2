import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/salons - List all salons
export async function GET() {
  try {
    console.log("[Salons API] Executing: SELECT * FROM salons");
    const allSalons = await db.select().from(salons);
    console.log(`[Salons API] Query returned ${allSalons.length} rows`);

    return NextResponse.json({
      success: true,
      data: allSalons,
      count: allSalons.length,
    });
  } catch (error) {
    console.error("[Salons API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch salons" },
      { status: 500 }
    );
  }
}

// POST /api/salons - Create a new salon
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, address, industryType, ownerId } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Salon name is required" },
        { status: 400 }
      );
    }

    console.log(`[Salons API] Executing: INSERT INTO salons (name, phone, email, address, industry_type, owner_id)`);
    const [newSalon] = await db
      .insert(salons)
      .values({
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        industryType: industryType || null,
        ownerId: ownerId || null,
      })
      .returning();

    console.log(`[Salons API] INSERT successful, created salon with id: ${newSalon.id}`);

    return NextResponse.json({
      success: true,
      data: newSalon,
    }, { status: 201 });
  } catch (error) {
    console.error("[Salons API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create salon" },
      { status: 500 }
    );
  }
}

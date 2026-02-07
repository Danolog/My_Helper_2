import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/clients - List all clients (optionally filtered by salon)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (salonId) {
      console.log(`[Clients API] Executing: SELECT * FROM clients WHERE salon_id = '${salonId}'`);
      const salonClients = await db
        .select()
        .from(clients)
        .where(eq(clients.salonId, salonId));
      console.log(`[Clients API] Query returned ${salonClients.length} rows`);

      return NextResponse.json({
        success: true,
        data: salonClients,
        count: salonClients.length,
      });
    }

    console.log("[Clients API] Executing: SELECT * FROM clients");
    const allClients = await db.select().from(clients);
    console.log(`[Clients API] Query returned ${allClients.length} rows`);

    return NextResponse.json({
      success: true,
      data: allClients,
      count: allClients.length,
    });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch clients" },
      { status: 500 }
    );
  }
}

// POST /api/clients - Create a new client
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, firstName, lastName, phone, email, notes, preferences, allergies, favoriteEmployeeId } = body;

    if (!salonId || !firstName || !lastName) {
      return NextResponse.json(
        { success: false, error: "salonId, firstName, and lastName are required" },
        { status: 400 }
      );
    }

    console.log(`[Clients API] Executing: INSERT INTO clients (salon_id, first_name, last_name, phone, email, notes, preferences, allergies, favorite_employee_id)`);
    const [newClient] = await db
      .insert(clients)
      .values({
        salonId,
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        preferences: preferences || null,
        allergies: allergies || null,
        favoriteEmployeeId: favoriteEmployeeId || null,
      })
      .returning();

    console.log(`[Clients API] INSERT successful, created client with id: ${newClient?.id}`);

    return NextResponse.json({
      success: true,
      data: newClient,
    }, { status: 201 });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create client" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/clients/[id] - Get a single client by ID
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    console.log(`[Clients API] Executing: SELECT * FROM clients WHERE id = '${id}'`);
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    console.log(`[Clients API] Found client: ${client.firstName} ${client.lastName}`);

    return NextResponse.json({
      success: true,
      data: client,
    });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch client" },
      { status: 500 }
    );
  }
}

// PUT /api/clients/[id] - Update a client
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { firstName, lastName, phone, email, notes, preferences, allergies, favoriteEmployeeId } = body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (notes !== undefined) updateData.notes = notes;
    if (preferences !== undefined) updateData.preferences = preferences;
    if (allergies !== undefined) updateData.allergies = allergies;
    if (favoriteEmployeeId !== undefined) updateData.favoriteEmployeeId = favoriteEmployeeId;

    console.log(`[Clients API] Updating client ${id}:`, updateData);

    const [updated] = await db
      .update(clients)
      .set(updateData)
      .where(eq(clients.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    console.log(`[Clients API] Updated client ${id} successfully`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update client" },
      { status: 500 }
    );
  }
}

// DELETE /api/clients/[id] - Delete a client
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(clients)
      .where(eq(clients.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    console.log(`[Clients API] Deleted client: ${deleted.firstName} ${deleted.lastName} (${deleted.id})`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    console.error("[Clients API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete client" },
      { status: 500 }
    );
  }
}

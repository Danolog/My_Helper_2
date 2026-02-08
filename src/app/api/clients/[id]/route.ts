import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients, account } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { verifyPassword } from "better-auth/crypto";

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

// DELETE /api/clients/[id] - Delete a client (requires password confirmation)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Verify the user is authenticated
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Musisz byc zalogowany, aby usunac klienta" },
        { status: 401 }
      );
    }

    // 2. Parse request body for password
    let body: { password?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Body parsing failed
    }

    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Haslo jest wymagane do usuniecia klienta" },
        { status: 400 }
      );
    }

    // 3. Get the user's password hash from the account table
    const [userAccount] = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, session.user.id),
          eq(account.providerId, "credential")
        )
      )
      .limit(1);

    if (!userAccount || !userAccount.password) {
      return NextResponse.json(
        { success: false, error: "Nie mozna zweryfikowac hasla - brak konta z haslem" },
        { status: 400 }
      );
    }

    // 4. Verify the password
    const isPasswordValid = await verifyPassword({
      hash: userAccount.password,
      password,
    });

    if (!isPasswordValid) {
      console.log(`[Clients API] Password verification failed for user ${session.user.email} when attempting to delete client ${id}`);
      return NextResponse.json(
        { success: false, error: "Nieprawidlowe haslo" },
        { status: 403 }
      );
    }

    // 5. Password verified - proceed with deletion
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

    console.log(`[Clients API] Deleted client: ${deleted.firstName} ${deleted.lastName} (${deleted.id}) by user ${session.user.email} after password verification`);

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

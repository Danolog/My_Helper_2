import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifyPassword } from "better-auth/crypto";
import { eq, and } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateClientSchema } from "@/lib/api-validation";
import { auth } from "@/lib/auth";
// `account` pozostaje surowym `db` (weryfikacja hasła nie jest salon-scoped):
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";
import { clients, account } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

// GET /api/clients/[id] - Get a single client by ID
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Clients API] GET",
    errorMessage: "Failed to fetch client",
  },
  async ({ params }) => {
    // Faza 3 (role): kartoteka klientów dla owner/receptionist; employee 403.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (ctx.role === "employee") {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }
    const salonId = ctx.salonId;

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid client ID format" },
        { status: 400 }
      );
    }

    const client = await forSalon(salonId).findOne(clients, id);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    logger.info(`[Clients API] Found client: ${client.id}`);

    return NextResponse.json({
      success: true,
      data: client,
    });
  }
);

// PUT /api/clients/[id] - Update a client
export const PUT = withApiHandler(
  {
    auth: "user",
    logLabel: "[Clients API] PUT",
    errorMessage: "Failed to update client",
  },
  async ({ request, params }) => {
    // Faza 3 (role): edycja klientów dla owner/receptionist; employee 403.
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (ctx.role === "employee") {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }
    const salonId = ctx.salonId;

    const id = params.id!; // segment [id] zawsze obecny (noUncheckedIndexedAccess)

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid client ID format" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Server-side validation with Zod schema
    // (walidacja celowo w handlerze, po sprawdzeniu salonu i UUID — jak dotąd)
    const validationError = validateBody(updateClientSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { firstName, lastName, phone, email, notes, preferences, allergies, favoriteEmployeeId, requireDeposit, depositType, depositValue } = body;

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
    if (requireDeposit !== undefined) updateData.requireDeposit = requireDeposit;
    if (depositType !== undefined) updateData.depositType = depositType;
    if (depositValue !== undefined) updateData.depositValue = depositValue;

    // Tylko nazwy pól — wartości (imię, telefon, e-mail, notatki) nie trafiają do logów.
    logger.info(`[Clients API] Updating client ${id}`, { fields: Object.keys(updateData) });

    const updated = await forSalon(salonId).updateOwned(clients, id, updateData);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    logger.info(`[Clients API] Updated client ${id} successfully`);

    return NextResponse.json({
      success: true,
      data: updated,
    });
  }
);

// DELETE /api/clients/[id] - Delete a client (requires password confirmation)
// UWAGA: świadomie NIE zmigrowane na withApiHandler — niestandardowa
// autoryzacja (bezpośrednio auth.api.getSession + weryfikacja hasła)
// i warunkowe parsowanie body nie mieszczą się w polityce wrappera.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid client ID format" },
        { status: 400 }
      );
    }

    // 1. Verify the user is authenticated
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Musisz byc zalogowany, aby usunac klienta" },
        { status: 401 }
      );
    }

    // 1a. Resolve the caller's salon — tenant isolation
    // Faza 3 (role): usuwanie klientów TYLKO owner, chyba że czasowy grant
    // "clients-delete" (temporary-access). Rola sprawdzana PRZED istniejącą
    // logiką (weryfikacja hasła zostaje bez zmian dla dopuszczonych ról).
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    if (ctx.role !== "owner" && !(await hasFeatureAccess(ctx, "clients-delete"))) {
      return NextResponse.json(
        { success: false, error: "Brak uprawnien" },
        { status: 403 }
      );
    }
    const salonId = ctx.salonId;

    // 1b. (ADR-001 sekcja 2.4) Cudzy/nieistniejacy zasob = 404 ZANIM dojdzie do
    // weryfikacji hasla — istnienie cudzego klienta nie moze przeciekac przez
    // kod statusu (dawniej DELETE zwracal 403 po nietrafionym hasle = mikrowyciek).
    const owned = await forSalon(salonId).findOne(clients, id);
    if (!owned) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
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
    // (account nie jest salon-scoped — to dane uwierzytelniajace uzytkownika)
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
      logger.info(`[Clients API] Password verification failed for user ${session.user.id} when attempting to delete client ${id}`);
      return NextResponse.json(
        { success: false, error: "Nieprawidlowe haslo" },
        { status: 403 }
      );
    }

    // 5. Password verified - proceed with deletion (scoped to caller's salon)
    const deleted = await forSalon(salonId).deleteOwned(clients, id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    logger.info(`[Clients API] Deleted client: ${deleted.id} by user ${session.user.id} after password verification`);

    return NextResponse.json({
      success: true,
      data: deleted,
    });
  } catch (error) {
    logger.error("[Clients API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete client" },
      { status: 500 }
    );
  }
}

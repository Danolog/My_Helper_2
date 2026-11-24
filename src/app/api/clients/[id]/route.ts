import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, updateClientSchema } from "@/lib/api-validation";
import { auth } from "@/lib/auth";
import { healthDataConsentRequiredBody, normalizeAllergies } from "@/lib/health-data-consent";
import { logger } from "@/lib/logger";
import { isRetryableLockFailure } from "@/lib/pg-lock-failure";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";
import { clients } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import {
  anonymizeClientData,
  countClientRemovalBlockers,
  lockClientForRemoval,
} from "@/lib/server/retention/anonymize-client";
import { findCredentialPasswordHash } from "@/lib/server/system";
import { isValidUuid } from "@/lib/validations";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

/** 409 przy usuwaniu klienta: przyszłe wizyty albo zadatek do zwrotu. */
const CLIENT_HAS_PENDING_OBLIGATIONS = "CLIENT_HAS_PENDING_OBLIGATIONS";
/** 503 przy usuwaniu klienta: konflikt blokad (lock_timeout albo zakleszczenie). */
const CLIENT_DELETE_RETRY = "CLIENT_DELETE_RETRY";
/** Po ilu sekundach UI może ponowić usunięcie po konflikcie blokad. */
const LOCK_RETRY_AFTER_SECONDS = 2;

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

    // healthDataConsentAt/By z body celowo nie są czytane — nadaje je serwer.
    const { firstName, lastName, phone, email, notes, preferences, allergies, healthDataConsent, favoriteEmployeeId, requireDeposit, depositType, depositValue } = body;

    // Informacja o zdrowiu (DPA §4): pusty napis = brak informacji (NULL, bez zgody).
    const allergiesValue = normalizeAllergies(allergies);
    const writesHealthData = typeof allergiesValue === "string";
    // Cofnięcie zgody z jednoczesnym wpisem alergii jest sprzeczne — odrzucamy.
    if (writesHealthData && healthDataConsent === false) {
      return NextResponse.json(healthDataConsentRequiredBody(), { status: 400 });
    }
    // Wpis alergii bez zgody w żądaniu wymaga zgody zapisanej wcześniej. Sprawdza
    // to warunek w samym UPDATE (niżej), więc równoległe cofnięcie zgody nie
    // przepuści zapisu między odczytem a zmianą.
    const requiresStoredConsent = writesHealthData && healthDataConsent !== true;

    // Build update object with only provided fields
    const updateData: PgUpdateSetSource<typeof clients> = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (notes !== undefined) updateData.notes = notes;
    if (preferences !== undefined) updateData.preferences = preferences;
    if (allergiesValue !== undefined) updateData.allergies = allergiesValue;
    if (healthDataConsent === true) {
      // Zgoda już zapisana zostaje z pierwotnym czasem i kontem (dowód pierwszej
      // zgody); nowa dostaje czas bazy i konto z sesji. Prawa strona SET czyta
      // wiersz sprzed UPDATE, więc oba CASE widzą ten sam stan.
      updateData.healthDataConsentAt = sql`coalesce(${clients.healthDataConsentAt}, now())`;
      updateData.healthDataConsentBy = sql`CASE WHEN ${clients.healthDataConsentAt} IS NULL THEN ${ctx.userId} ELSE ${clients.healthDataConsentBy} END`;
    } else if (healthDataConsent === false) {
      // Cofnięcie zgody: informacja o zdrowiu znika w tym samym UPDATE.
      updateData.allergies = null;
      updateData.healthDataConsentAt = null;
      updateData.healthDataConsentBy = null;
    }
    if (favoriteEmployeeId !== undefined) updateData.favoriteEmployeeId = favoriteEmployeeId;
    if (requireDeposit !== undefined) updateData.requireDeposit = requireDeposit;
    if (depositType !== undefined) updateData.depositType = depositType;
    if (depositValue !== undefined) updateData.depositValue = depositValue;

    // Tylko nazwy pól — wartości (imię, telefon, e-mail, notatki) nie trafiają do logów.
    logger.info(`[Clients API] Updating client ${id}`, { fields: Object.keys(updateData) });

    const outcome = await forSalon(salonId).raw(async (tx) => {
      const ownClient = and(eq(clients.id, id), eq(clients.salonId, salonId));
      const [row] = await tx
        .update(clients)
        .set(updateData)
        .where(requiresStoredConsent ? and(ownClient, isNotNull(clients.healthDataConsentAt)) : ownClient)
        .returning();
      if (row) return { kind: "updated" as const, row };
      if (!requiresStoredConsent) return { kind: "not_found" as const };
      // Zero wierszy przy warunku zgody: odróżnij brak zgody (400) od braku klienta (404).
      const [existing] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(ownClient)
        .limit(1);
      return existing ? { kind: "consent_required" as const } : { kind: "not_found" as const };
    });

    if (outcome.kind === "consent_required") {
      return NextResponse.json(healthDataConsentRequiredBody(), { status: 400 });
    }
    if (outcome.kind === "not_found") {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }
    const updated = outcome.row;

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

    // 3. Get the user's password hash (konto `credential` uzytkownika z sesji;
    // account nie jest salon-scoped — wyjscie systemowe, nie forSalon)
    const passwordHash = await findCredentialPasswordHash(session.user.id);

    if (!passwordHash) {
      return NextResponse.json(
        { success: false, error: "Nie mozna zweryfikowac hasla - brak konta z haslem" },
        { status: 400 }
      );
    }

    // 4. Verify the password
    const isPasswordValid = await verifyPassword({
      hash: passwordHash,
      password,
    });

    if (!isPasswordValid) {
      logger.info(`[Clients API] Password verification failed for user ${session.user.id} when attempting to delete client ${id}`);
      return NextResponse.json(
        { success: false, error: "Nieprawidlowe haslo" },
        { status: 403 }
      );
    }

    // 5. Hasło potwierdzone. Jedna transakcja salonu: blokady → sprawdzenie
    // zobowiązań → anonimizacja → DELETE. Sprawdzenie idzie PO blokadach, więc
    // rezerwacja zatwierdzona w międzyczasie albo czeka na blokadę klienta
    // (i po usunięciu dostaje błąd klucza obcego), albo jest już widoczna
    // w liczeniu i daje 409. PRZED anonimizacją — 409 nie zapisuje nic.
    const outcome = await forSalon(salonId).raw(async (tx) => {
      if (!(await lockClientForRemoval(tx, salonId, id))) {
        return { kind: "not_found" as const };
      }
      const blockers = await countClientRemovalBlockers(tx, salonId, id);
      if (blockers.futureAppointments > 0 || blockers.depositsToRefund > 0) {
        return { kind: "blocked" as const, blockers };
      }
      await anonymizeClientData(tx, salonId, id);
      const [row] = await tx
        .delete(clients)
        .where(and(eq(clients.id, id), eq(clients.salonId, salonId)))
        .returning({ id: clients.id });
      return row ? { kind: "deleted" as const, row } : { kind: "not_found" as const };
    });

    if (outcome.kind === "blocked") {
      // Same liczby, bez danych klienta.
      return NextResponse.json(
        {
          success: false,
          code: CLIENT_HAS_PENDING_OBLIGATIONS,
          error: "Klient ma przyszłe wizyty albo zadatek do zwrotu",
          futureAppointments: outcome.blockers.futureAppointments,
          depositsToRefund: outcome.blockers.depositsToRefund,
        },
        { status: 409 }
      );
    }
    if (outcome.kind === "not_found") {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }
    const deleted = outcome.row;

    logger.info(`[Clients API] Deleted client: ${deleted.id} by user ${session.user.id} after password verification`);

    // Tylko identyfikator: usuwanej kartoteki (z alergiami) nie wysyłamy
    // ponownie — panel czyta wyłącznie `success`.
    return NextResponse.json({
      success: true,
      data: { id: deleted.id },
    });
  } catch (error) {
    if (isRetryableLockFailure(error)) {
      // Równoległy zapis trzyma klienta albo jego wizyty. Transakcja wycofana,
      // nic nie zapisane; ponowienie zostawiamy użytkownikowi (hasło już
      // sprawdzone, ukryta pętla w serwerze tylko wydłużyłaby blokady).
      logger.warn("[Clients API] DELETE: konflikt blokad", { code: toErrorIdentity(error).errorCode });
      return NextResponse.json(
        { success: false, code: CLIENT_DELETE_RETRY, error: "Spróbuj ponownie za chwilę" },
        { status: 503, headers: { "Retry-After": String(LOCK_RETRY_AFTER_SECONDS) } }
      );
    }
    logger.error("[Clients API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete client" },
      { status: 500 }
    );
  }
}

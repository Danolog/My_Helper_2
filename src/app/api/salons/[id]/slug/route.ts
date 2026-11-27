import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isValidUuid, parseBody, updateSalonSlugSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { isSalonSlugConflict } from "@/lib/salon-slug";
import { salons } from "@/lib/schema";
// Odczyt własności i zapis przez forSalon(id z URL), jak PUT /api/salons/[id]:
// polityka RLS `salons` przepuszcza wiersz o id = kontekst, więc brak wiersza
// = 404, cudzy właściciel = 403. Zajętość adresu sprawdza indeks unikalny
// (salons_slug_uq) — w kontekście jednego salonu RLS i tak nie pokazałby
// sluga innego salonu, a sprawdzenie przed zapisem miałoby wyścig.
import { forSalon } from "@/lib/server/repository";

const SLUG_TAKEN_CODE = "SLUG_TAKEN";

/**
 * PUT /api/salons/[id]/slug — zmiana krótkiego adresu salonu `/s/<slug>`.
 *
 * Body: `{ slug: string }` (updateSalonSlugSchema). Tylko właściciel salonu.
 * Odpowiedzi: 200 `{ success, data: { slug } }`, 400 (zły id albo slug),
 * 401 (bez sesji), 403 (nie właściciel), 404 (brak salonu),
 * 409 `SLUG_TAKEN` (adres zajęty przez inny salon), 500.
 * Ten sam slug co obecny → 200 bez zmian w bazie poza `updated_at`.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  try {
    const { id } = await params;
    // Format przed forSalon: polityka RLS rzutuje kontekst na ::uuid — zły
    // format dałby 500 z bazy zamiast 400.
    if (!isValidUuid(id)) {
      return NextResponse.json({ success: false, error: "Invalid salon id" }, { status: 400 });
    }

    const [salon] = await forSalon(id).raw((tx) =>
      tx
        .select({ id: salons.id, ownerId: salons.ownerId })
        .from(salons)
        .where(eq(salons.id, id))
    );
    if (!salon) {
      return NextResponse.json({ success: false, error: "Salon nie znaleziony" }, { status: 404 });
    }
    if (salon.ownerId !== authResult.user.id) {
      return NextResponse.json({ success: false, error: "Brak uprawnien" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Nieprawidlowe dane" }, { status: 400 });
    }
    const parsed = parseBody(updateSalonSlugSchema, body);
    if (!parsed.ok) {
      return NextResponse.json(parsed.error, { status: 400 });
    }
    const { slug } = parsed.data;

    try {
      await forSalon(id).raw((tx) =>
        tx.update(salons).set({ slug }).where(eq(salons.id, id))
      );
    } catch (error) {
      if (isSalonSlugConflict(error)) {
        return NextResponse.json(
          { success: false, code: SLUG_TAKEN_CODE, error: "Ten adres jest już zajęty. Wybierz inny." },
          { status: 409 }
        );
      }
      throw error;
    }

    logger.info("[Salon Slug API] Slug updated", { salonId: id });
    return NextResponse.json({ success: true, data: { slug } });
  } catch (error) {
    logger.error("[Salon Slug API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zmienic adresu salonu" },
      { status: 500 }
    );
  }
}

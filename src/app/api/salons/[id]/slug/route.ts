import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { isValidUuid, parseBody, updateSalonSlugSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { isSalonSlugConflict, SALON_SLUG_MAX_CHANGES } from "@/lib/salon-slug";
import { salonSlugHistory, salons } from "@/lib/schema";
// Odczyt własności i zapis przez forSalon(id z URL), jak PUT /api/salons/[id]:
// polityka RLS `salons` przepuszcza wiersz o id = kontekst, więc brak wiersza
// = 404, cudzy właściciel = 403. Zajętość adresu sprawdzają ograniczenia bazy
// (klucz główny rejestru salon_slug_history i salons_slug_uq) — w kontekście
// jednego salonu RLS i tak nie pokazałby adresów innych salonów, a sprawdzenie
// przed zapisem miałoby wyścig.
import { forSalon, type DbTx } from "@/lib/server/repository";

const SLUG_TAKEN_CODE = "SLUG_TAKEN";
const SLUG_CHANGE_LIMIT_CODE = "SLUG_CHANGE_LIMIT";

/** Salon wykorzystał limit zmian adresu — transakcja jest cofana, nic się nie zapisuje. */
class SlugChangeLimitError extends Error {
  constructor() {
    super(SLUG_CHANGE_LIMIT_CODE);
  }
}

/**
 * Zmiana adresu w jednej transakcji salonu (kontekst RLS = `salonId`).
 *
 * Rejestr `salon_slug_history` trzyma każdy adres, który salon miał: bieżący
 * (`retiredAt` null) i dawne. Klucz główny to sam slug, więc adres należący
 * albo należący kiedyś do innego salonu daje 23505 przy wstawieniu — także
 * przy dwóch równoległych transakcjach (druga czeka na pierwszą).
 *
 * Kroki:
 * 1. blokada wiersza salonu (FOR UPDATE) i odczyt obecnego sluga — dwie
 *    równoległe zmiany tego samego salonu idą po kolei;
 * 2. obecny adres bieżący w rejestrze → dawny (`retiredAt` = teraz);
 * 3. obecny adres zapisany jako dawny, jeśli rejestr go nie zna (salon
 *    założony poza aplikacją, np. seed) — ON CONFLICT DO NOTHING, bo zwykle
 *    wiersz już jest z kroku 2;
 * 4. odzyskanie własnego dawnego adresu: usunięcie WŁASNEGO wiersza nowego
 *    sluga (RLS i warunek salonId nie sięgają do cudzych wierszy);
 * 5. nowy adres jako bieżący — konflikt klucza = adres innego salonu → 409;
 * 6. zapis w `salons` — konflikt salons_slug_uq = adres innego salonu → 409.
 * Błąd w dowolnym kroku cofa całość.
 *
 * Ten sam slug co obecny: tylko krok 6 (bez zmian w rejestrze).
 */
async function changeSalonSlug(tx: DbTx, salonId: string, slug: string): Promise<void> {
  const [current] = await tx
    .select({ slug: salons.slug })
    .from(salons)
    .where(eq(salons.id, salonId))
    .for("update");
  const previousSlug = current?.slug ?? null;

  if (previousSlug !== slug) {
    // Limit liczymy w tej samej transakcji, przed jakimkolwiek zapisem, i po
    // blokadzie wiersza salonu — równoległe zmiany nie obejdą limitu. Własne
    // wiersze rejestru (RLS) dzielimy w pamięci: odzyskanie własnego dawnego
    // adresu nie zajmuje nowego miejsca, więc limitu nie dotyczy.
    const ownEntries = await tx
      .select({ slug: salonSlugHistory.slug, retiredAt: salonSlugHistory.retiredAt })
      .from(salonSlugHistory)
      .where(eq(salonSlugHistory.salonId, salonId));
    const retired = ownEntries.filter((entry) => entry.retiredAt !== null);
    const isRecovery = retired.some((entry) => entry.slug === slug);
    if (retired.length >= SALON_SLUG_MAX_CHANGES && !isRecovery) {
      throw new SlugChangeLimitError();
    }

    const retiredAt = new Date();
    await tx
      .update(salonSlugHistory)
      .set({ retiredAt })
      .where(and(eq(salonSlugHistory.salonId, salonId), isNull(salonSlugHistory.retiredAt)));
    if (previousSlug) {
      await tx
        .insert(salonSlugHistory)
        .values({ slug: previousSlug, salonId, retiredAt })
        .onConflictDoNothing({ target: salonSlugHistory.slug });
    }
    await tx
      .delete(salonSlugHistory)
      .where(and(eq(salonSlugHistory.slug, slug), eq(salonSlugHistory.salonId, salonId)));
    await tx.insert(salonSlugHistory).values({ slug, salonId });
  }

  await tx.update(salons).set({ slug }).where(eq(salons.id, salonId));
}

/**
 * PUT /api/salons/[id]/slug — zmiana krótkiego adresu salonu `/s/<slug>`.
 *
 * Body: `{ slug: string }` (updateSalonSlugSchema). Tylko właściciel salonu.
 * Odpowiedzi: 200 `{ success, data: { slug } }`, 400 (zły id albo slug),
 * 401 (bez sesji), 403 (nie właściciel), 404 (brak salonu),
 * 409 `SLUG_TAKEN` (adres bieżący albo dawny innego salonu), 409
 * `SLUG_CHANGE_LIMIT` (salon ma już `SALON_SLUG_MAX_CHANGES` wycofanych
 * adresów, a nowy nie jest odzyskaniem własnego), 500.
 * Stary adres zostaje w rejestrze jako dawny: `/s/<stary>` dalej prowadzi do
 * tego salonu, a inny salon nie może go zająć. Własny dawny adres wolno
 * odzyskać.
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
      await forSalon(id).raw((tx) => changeSalonSlug(tx, id, slug));
    } catch (error) {
      if (error instanceof SlugChangeLimitError) {
        return NextResponse.json(
          {
            success: false,
            code: SLUG_CHANGE_LIMIT_CODE,
            error: "Osiągnięto limit zmian adresu. Napisz do nas, jeśli potrzebujesz kolejnej zmiany.",
          },
          { status: 409 }
        );
      }
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
